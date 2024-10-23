import { RpcError } from './client.js';
import { handleRpc } from './server.js';
import { type JsonRpcRequest, type JsonRpcResponse } from './types.js';

type PendingResponse = {
    resolve: (res: JsonRpcResponse) => void;
};

const makeDeferred = <T>() => {
    let res: (value: T) => void;
    let rej: (reason: any) => void;
    const promise = new Promise((resolve, reject) => {
        res = resolve;
        rej = reject;
    });
    return {
        promise,
        resolve: res!,
        reject: rej!,
    };
}

const isMessagePort = (port: any): port is MessagePort => (port as MessagePort).addEventListener !== undefined;

export class MessagePortTransport {
    // This is a map of promises that are resolved when a response is received
    private promises = new Map<string, PendingResponse>();
    private readyPromise = makeDeferred<void>();

    public constructor(private _port?: MessagePort) {
        if (_port) {
            this.init();
        }
    };

    public set port(port: MessagePort) {
        this._port = port;
        this.init();
    }

    protected init() {
        if (!this._port) {
            return;
        }

        // Find the correct response promise and resolve it
        const handler = async (event: MessageEvent) => {
            const id = event.data.id.toString();
            if (id) {
                const deferred = this.promises.get(id);
                if (!deferred) {
                    throw new RpcError(`No promise found for id: ${id}`, -1);
                }
                this.promises.delete(id);
                deferred.resolve(event.data);
            }
        };

        if (isMessagePort(this._port)) {
            this._port.onmessage = handler;
        }

        this._port.start();

        // Connection is ready
        this.readyPromise.resolve();
    }

    public transport = async (req: JsonRpcRequest, _signal: AbortSignal): Promise<any> => {
        await this.readyPromise.promise;

        if (!this._port) {
            throw new RpcError('Port unavailble', -1);
        }

        const id = req.id?.toString();

        if (!id) {
            throw new RpcError('No id found', -1);
        }

        this._port.postMessage(req);

        if (this.promises.has(id)) {
            throw new RpcError(`Promise already exists for id: ${id}`, -1);
        }

        return new Promise(resolve => {
            this.promises.set(id, { resolve });
        });
    };
}

export const messagePortHandler = (port: MessagePort, service: any) => {
    const handler = async (event: MessageEvent) => {
        // Handle main RPC request
        let result = await handleRpc(event.data, service);
        port.postMessage(result);
    };

    if (isMessagePort(port)) {
        port.onmessage = handler;
    }

    port.start();
};

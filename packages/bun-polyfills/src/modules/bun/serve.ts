import type {
    Server as BunServer, Serve, TLSServeOptions, UnixTLSServeOptions, TLSWebSocketServeOptions, UnixTLSWebSocketServeOptions, ArrayBufferView, SocketAddress, WebSocketHandler
} from 'bun';
import http from 'node:http';
import { toWebRequest, sendWebResponse, requestRemoteIPSymbol, requestNodeResSymbol } from '../../utils/webconv.js';

export function serve<T>(options: Serve<T>): BunServer {
    return new Server(options);
}
serve satisfies typeof Bun.serve;

class Server<T = undefined> extends http.Server implements BunServer {
    constructor(options: Serve<T>) {
        super();
        const listenOn = ('unix' in options && typeof options.unix === 'string')
            ? { hostname: '', port: undefined, unix: options.unix }
            : {
                hostname: String(options.hostname ?? '0.0.0.0'),
                port: +(options.port ?? process.env.PORT ?? 3000),
            };
        const ws = 'websocket' in options ? options.websocket : null;
        const tls = isTLS(options) ? options : null;
        this.development = !!options.development ?? process.env.NODE_ENV !== 'production';
        this.hostname = listenOn.hostname ?? '';
        this.port = listenOn.port as number, //? bun-types needs to include undefined here since Bun does it for Unix servers
        this.id = options.id ?? '';
        // missing from bun-types (?) + untested if these types are right yet
        this.protocol = ws ? (tls ? 'wss' : 'ws') : (tls ? 'https' : 'http');
        // privates
        this.#ws = ws;
        this.#tls = tls;
        this.#unix = listenOn.unix;
        this.#maxReqBodySize = +(options.maxRequestBodySize || 128 * 1024 * 1024);
        this.#onError = options.error;
        this.#onRequest = options.fetch;
        if (!this.#onRequest) throw new TypeError('Expected fetch() to be a function');

        this.on('request', async (req, res) => {
            const webRes = await this.#onRequest!(toWebRequest(req, res, this.#maxReqBodySize), this);
            if (webRes) sendWebResponse(res, webRes);
        });

        if (this.#onError) {
            this.on('error', this.#onError);
            this.on('clientError', this.#onError);
        }

        if (this.#unix) this.listen({ path: this.#unix });
        else this.listen({ host: this.hostname, port: this.port });
    }
    #ws: WebSocketHandler<T> | null;
    #tls: TLSOptions<T> | null;
    #unix?: string;
    #maxReqBodySize: number;
    #onError?: Serve<T>['error'];
    #onRequest: Serve<T>['fetch'];
    development: boolean;
    hostname: string;
    port: number;
    id: string;
    protocol: string; //? see note in constructor
    pendingRequests = 0;
    pendingWebSockets = 0;
    fetch(request: string | Request): Response | Promise<Response> {
        if (typeof request === 'string') request = new Request(request);
        return this.#onRequest(request, this) as Response | Promise<Response>; // not sure what to do if this is undefined? error? TODO
    }
    publish(topic: string, data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer, compress?: boolean): number {
        throw new Error('Method not implemented.'); // TODO
    }
    upgrade<T = undefined>(request: Request, options?: { headers?: HeadersInit; data?: T; }): boolean {
        const nodeRes = Reflect.get(request, requestNodeResSymbol) as http.ServerResponse | undefined;
        if (!nodeRes) throw new Error('This polyfill can only upgrade requests created by the Bun.serve polyfills');
        try {
            // bun-types HeadersInit is not compatible with node HeadersInit, assuming this is a bug in bun-types for now.
            const headers = new Headers(options?.headers as ConstructorParameters<typeof Headers>[0]);
            headers.set('Connection', 'Upgrade');
            headers.set('Upgrade', 'websocket');
            nodeRes.writeHead(101, Object.fromEntries(headers)).end();
            return true;
        } catch (_err) {
            return false;
        }
    }
    requestIP(request: Request): SocketAddress | null {
        const ip = Reflect.get(request, requestRemoteIPSymbol) as Partial<SocketAddress>;
        if (ip.address || ip.port || ip.family) return ip as SocketAddress;
        else return null;
    }
    reload(options: Serve): void {
        this.#onRequest = options.fetch ?? this.#onRequest;
        this.#onError = options.error ?? this.#onError;
    }
    stop(closeActiveConnections?: boolean): void {
        if (closeActiveConnections) super.closeAllConnections();
        super.close();
    }
};

type TLSOptions<T> = TLSServeOptions | UnixTLSServeOptions | TLSWebSocketServeOptions<T> | UnixTLSWebSocketServeOptions<T>;
function isTLS<T>(options: Serve<T>): options is TLSOptions<T> {
    return (
        'tls' in options || 'serverNames' in options
        || 'keyFile' in options || 'certFile' in options || 'caFile' in options
        || 'key' in options || 'cert' in options || 'ca' in options
        || 'passphrase' in options || 'dhParamsFile' in options
        || 'serverName' in options || 'lowMemoryMode' in options || 'secureOptions' in options
    );
}

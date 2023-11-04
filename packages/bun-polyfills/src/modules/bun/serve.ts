/// <reference types="node" />
import type {
    Server as BunServer, Serve, TLSServeOptions, UnixTLSServeOptions, TLSWebSocketServeOptions, UnixTLSWebSocketServeOptions, ArrayBufferView, SocketAddress, WebSocketHandler, ServerWebSocket, WebSocketCompressor
} from 'bun';
import { createHash } from 'node:crypto';
import uws from 'uWebSockets.js';

type uwsInternalField = { res: uws.HttpResponse; req: uws.HttpRequest; };
type uwsUpgradableRequest = { secwskey: string; secwsprotocol: string; secwsextensions: string; context: uws.us_socket_context_t; };
const uwsInternalFieldSymbol = Symbol('bun-polyfills.serve.uwsInternalField');
const uwsUpgradableRequestSymbol = Symbol('bun-polyfills.serve.uwsUpgradableRequest');

const wsCompressors: Record<WebSocketCompressor, number> = {
    '128KB': uws.DEDICATED_COMPRESSOR_128KB,
    '16KB': uws.DEDICATED_COMPRESSOR_16KB,
    '256KB': uws.DEDICATED_COMPRESSOR_256KB,
    '32KB': uws.DEDICATED_COMPRESSOR_32KB,
    '3KB': uws.DEDICATED_COMPRESSOR_3KB,
    '4KB': uws.DEDICATED_COMPRESSOR_4KB,
    '64KB': uws.DEDICATED_COMPRESSOR_64KB,
    '8KB': uws.DEDICATED_COMPRESSOR_8KB,
    dedicated: uws.DEDICATED_COMPRESSOR_32KB,
    disable: uws.DISABLED,
    shared: uws.SHARED_COMPRESSOR,
} as const;

export function serve<T>(options: Serve<T>): BunServer {
    return new Server(options);
}
serve satisfies typeof Bun.serve;

class Server<T = undefined> implements BunServer {
    constructor(options: Serve<T>) {
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
        this.id = options.id ?? '';
        // missing from bun-types (?) + untested if these values are right yet
        this.protocol = ws ? (tls ? 'wss' : 'ws') : (tls ? 'https' : 'http');
        // privates
        this.#ws = ws;
        this.#tls = tls;
        //this.#unix = listenOn.unix;
        this.#maxReqBodySize = +(options.maxRequestBodySize || 128 * 1024 * 1024);
        this.#onError = options.error;
        this.#onRequest = options.fetch;
        if (!this.#onRequest) throw new TypeError('Expected fetch() to be a function');

        this.#uws = uws[tls ? 'SSLApp' : 'App']({
            ca_file_name: tls?.ca instanceof Blob ? tls.ca.name
                : tls?.ca instanceof Array ? (tls.ca[0] instanceof Blob ? tls.ca[0].name : tls.ca[0]) : tls?.ca,
            cert_file_name: tls?.cert instanceof Blob ? tls.cert.name
                : tls?.cert instanceof Array ? (tls.cert[0] instanceof Blob ? tls.cert[0].name : tls.cert[0]) : tls?.cert,
            dh_params_file_name: tls?.dhParamsFile,
            key_file_name: tls?.key instanceof Blob ? tls.key.name
                : tls?.key instanceof Array ? (tls.key[0] instanceof Blob ? tls.key[0].name : tls.key[0]) : tls?.key,
            passphrase: tls?.passphrase,
            ssl_ciphers: tls?.secureOptions?.toString(),
            ssl_prefer_low_memory_usage: tls?.lowMemoryMode,
        });

        const httpHandler = async (res: uws.HttpResponse, req: uws.HttpRequest) => {
            this.pendingRequests++;
            res.onAborted(() => {
                if (this.#onError) this.#onError(new Error('Aborted'));
            });
            const headers = new Headers();
            req.forEach((name, value) => headers.append(name, value));
            const query = req.getQuery();
            const url = `${tls ? 'https' : 'http'}://${headers.get('host')}${req.getUrl()}${query ? '?' + query : ''}`;
            const method = req.getMethod();
            const body = method === 'GET' || method === 'HEAD' ? undefined : await getUwsHttpResponseBody(res, this.#maxReqBodySize);
            const webReq = new Request(url, {
                method,
                headers,
                body: body?.byteLength ? body : undefined,
            });
            Reflect.set(webReq, uwsInternalFieldSymbol, { res, req });
            const webRes = await this.#onRequest(webReq, this);
            if (Reflect.get(req, uwsUpgradableRequestSymbol)) return void this.pendingRequests--;
            if (!webRes) return this.pendingRequests--, void res.endWithoutBody();
            for (const [name, value] of webRes.headers) {
                res.writeHeader(name, value);
            }
            res.writeStatus(`${webRes.status} ${webRes.statusText}`);
            res.end(await webRes.arrayBuffer());
            this.pendingRequests--;
        };
        this.#uws.any('/*', httpHandler);

        if (this.#ws) this.#uws.ws('/*', {
            sendPingsAutomatically: this.#ws.sendPings ?? true,
            idleTimeout: this.#ws.idleTimeout ?? 120,
            maxBackpressure: this.#ws.backpressureLimit ?? 1024 * 1024 * 16,
            maxPayloadLength: this.#ws.maxPayloadLength ?? 1024 * 1024 * 16,
            closeOnBackpressureLimit: Number(this.#ws.closeOnBackpressureLimit ?? false),
            compression: !this.#ws.perMessageDeflate || typeof this.#ws.perMessageDeflate === 'boolean'
                ? (this.#ws.perMessageDeflate ? uws.SHARED_COMPRESSOR : uws.DISABLED)
                : !this.#ws.perMessageDeflate.compress || typeof this.#ws.perMessageDeflate.compress === 'boolean'
                    ? (this.#ws.perMessageDeflate.compress ? uws.SHARED_COMPRESSOR : uws.DISABLED)
                    : wsCompressors[this.#ws.perMessageDeflate.compress],

            close: (ws, code, message) => {
                if (this.#ws?.close) this.#ws.close(toBunSocket(ws), code, Buffer.from(message).toString('utf8'));
            },
            drain: (ws) => {
                if (this.#ws?.drain) this.#ws.drain(toBunSocket(ws));
            },
            message: (ws, message, isBinary) => {
                if (this.#ws?.message) {
                    const buf = Buffer.from(message);
                    this.#ws.message(toBunSocket(ws), isBinary ? buf : buf.toString('utf8'));
                }
            },
            open: (ws) => {
                this.pendingWebSockets++;
                if (this.#ws?.open) this.#ws.open(toBunSocket(ws));
                this.pendingWebSockets--;
            },
            ping: (ws, message) => {
                if (this.#ws?.ping) this.#ws.ping(toBunSocket(ws), Buffer.from(message));
            },
            pong: (ws, message) => {
                if (this.#ws?.pong) this.#ws.pong(toBunSocket(ws), Buffer.from(message));
            },
            subscription: (ws, topic, newCount, oldCount) => {

            },
            upgrade: async (res, req, context) => {
                const secwskey = req.getHeader('sec-websocket-key');
                const secwsprotocol = req.getHeader('sec-websocket-protocol');
                const secwsextensions = req.getHeader('sec-websocket-extensions');
                Reflect.set(req, uwsUpgradableRequestSymbol, { secwskey, secwsprotocol, secwsextensions, context });
                await httpHandler(res, req);
            },
        });

        if (listenOn.unix) this.#uws.listen_unix((listenSock) => { this.#listenSock = listenSock }, listenOn.unix);
        else this.#uws.listen(listenOn.hostname!, listenOn.port ?? 0, (listenSock) => { this.#listenSock = listenSock });
    }
    #listenSock: uws.us_listen_socket | null = null;
    #uws: uws.TemplatedApp;
    #ws: WebSocketHandler<T> | null;
    #tls: TLSOptions<T> | null;
    //#unix?: string;
    #maxReqBodySize: number;
    #onError?: Serve<T>['error'];
    #onRequest: Serve<T>['fetch'];
    #closed = false;
    development: boolean;
    hostname: string;
    get port(): number {
        const port = uws.us_socket_local_port(this.#listenSock!);
        return port === -1 ? undefined as unknown as number : port;
    }
    id: string;
    protocol: string; //? see note in constructor
    pendingRequests = 0;
    pendingWebSockets = 0;
    fetch(request: string | Request): Response | Promise<Response> {
        if (typeof request === 'string') request = new Request(request);
        return this.#onRequest(request, this) as Response | Promise<Response>;
    }
    publish(topic: string, data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer, compress?: boolean): number {
        const message = (typeof data === 'string' ? data : 'buffer' in data ? data.buffer : data) as string | ArrayBuffer;
        const success = this.#uws.publish(topic, message, typeof message !== 'string', compress);
        if (!success) return 0;
        return typeof message === 'string' ? message.length : message.byteLength;
    }
    upgrade<T = undefined>(request: Request, options?: { headers?: HeadersInit; data?: T; }): boolean {
        const uwsInfo = Reflect.get(request, uwsInternalFieldSymbol) as uwsInternalField | undefined;
        if (!uwsInfo) return false; // This polyfill can only upgrade requests created by itself
        const { req, res } = uwsInfo;
        const ctx = Reflect.get(req, uwsUpgradableRequestSymbol) as uwsUpgradableRequest | undefined;
        if (!ctx) return false;
        res.upgrade({}, ctx.secwskey, ctx.secwsprotocol, ctx.secwsextensions, ctx.context);
        return true;
    }
    requestIP(request: Request): SocketAddress | null {
        const uwsInfo = Reflect.get(request, uwsInternalFieldSymbol) as uwsInternalField | undefined;
        if (!uwsInfo) return null;
        const fullIP = new TextDecoder().decode(uwsInfo.res.getRemoteAddressAsText());
        const [ip, port] = fullIP.split(':');
        return {
            address: ip,
            port: Number(port),
            family: ip.includes('.') ? 'IPv4' : 'IPv6',
        };
    }
    reload(options: Serve): void {
        this.#onRequest = options.fetch ?? this.#onRequest;
        this.#onError = options.error ?? this.#onError;
    }
    stop(closeActiveConnections?: boolean): void {
        if (closeActiveConnections) return void this.#uws.close();
        this.#closed = true;
        uws.us_listen_socket_close(this.#listenSock!);
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

function generateSecWSAccept(secWSKey: string) {
    return createHash('sha1')
        .update(secWSKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', 'binary')
        .digest('base64');
}

// TODO
function toBunSocket(socket: uws.WebSocket<any>) {
    return socket as unknown as ServerWebSocket<any>;
}

async function getUwsHttpResponseBody(res: uws.HttpResponse, maxSize: number) {
    return new Promise<Buffer>((resolve, reject) => {
        const buffers: Buffer[] = [];
        let totalSize = 0;
        res.onData((ab, isLast) => {
            const chunk = Buffer.from(ab);
            totalSize += chunk.byteLength;
            if (totalSize > maxSize) return void res.close(); // calls onAborted
            if (!isLast) return void buffers.push(chunk);
            try {
                if (buffers.length === 0) return void resolve(Buffer.from(structuredClone(ab)));
                buffers.push(chunk);
                return void resolve(Buffer.concat(buffers, totalSize));
            } catch (e) {
                return void res.close(); // calls onAborted
            }
        });
    });
}

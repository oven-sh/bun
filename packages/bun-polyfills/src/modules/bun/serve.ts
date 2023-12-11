/// <reference types="node" />
import type {
    Serve, TLSServeOptions, UnixTLSServeOptions, TLSWebSocketServeOptions, UnixTLSWebSocketServeOptions,
    Server as BunServer, ArrayBufferView, SocketAddress, WebSocketHandler, ServerWebSocket, WebSocketCompressor
} from 'bun';
import { serve as honoServe } from '@hono/node-server';
import { WebSocketServer, type AddressInfo } from 'ws';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { requestRemoteIPSymbol, requestUpgradedSymbol, toWebRequest } from '../../utils/webconv.js';

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
        this.url = new URL(`${tls ? 'https' : 'http'}://${listenOn.hostname || 'localhost'}:${listenOn.port ?? 0}`); // TODO
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

        if (tls?.ca instanceof Blob) tls.ca = tls.ca.name;
        if (tls?.ca instanceof Array) tls.ca = tls.ca.map((ca) => ca instanceof Blob ? ca.name! : ca);
        if (tls?.cert instanceof Blob) tls.cert = tls.cert.name;
        if (tls?.cert instanceof Array) tls.cert = tls.cert.map((cert) => cert instanceof Blob ? cert.name! : cert);
        if (tls?.key instanceof Blob) tls.key = tls.key.name;
        if (tls?.key instanceof Array) tls.key = tls.key.map((key) => key instanceof Blob ? key.name! : key);
        this.#server = honoServe({
            serverOptions: {
                ca: tls?.ca as string | Buffer | (string | Buffer)[] | undefined,
                cert: tls?.cert as string | Buffer | (string | Buffer)[] | undefined,
                dhparam: tls?.dhParamsFile ? fs.readFileSync(tls.dhParamsFile) : undefined,
                key: tls?.key as string | Buffer | (string | Buffer)[] | undefined,
                passphrase: tls?.passphrase,
            },
            hostname: listenOn.hostname,
            port: listenOn.port,
            fetch: async (request) => {
                this.pendingRequests++;
                const response = await this.#onRequest(request, this);
                this.pendingRequests--;
                return response;
            },
        }, (info) => { }) as http.Server;
        this.#server.listen(listenOn.port, listenOn.hostname);
        this.#server.on('error', (error) => {
            if (this.#onError) this.#onError(error);
        });
        this.#server.on('upgrade', (req, duplex, head) => {
            this.#onRequest(toWebRequest(req, undefined, this.#maxReqBodySize, true), this);
        });

        this.#wss = new WebSocketServer({
            server: this.#server,
            perMessageDeflate: typeof ws?.perMessageDeflate === 'boolean'
                ? ws.perMessageDeflate : !!ws?.perMessageDeflate?.compress || !!ws?.perMessageDeflate?.decompress,
            backlog: ws?.backpressureLimit,
            // @ts-expect-error untyped "maxPayload" option but it's in the docs
            maxPayload: ws?.maxPayloadLength,
        });
        this.#wss.on('connection', (socket, req) => {
            this.pendingWebSockets++;
            this.#ws?.open?.(toBunSocket(socket, this));
            if (this.#ws?.close) socket.onclose = (event) => {
                this.#ws?.close?.(toBunSocket(socket, this), event.code, event.reason);
                this.pendingWebSockets--;
            };
            if (this.#ws?.message) socket.onmessage = (event) => this.#ws?.message?.(toBunSocket(socket, this), event.data);
            if (this.#ws?.ping) socket.addEventListener('ping', (event) => this.#ws?.ping?.(toBunSocket(socket, this), event.data));
            if (this.#ws?.pong) socket.addEventListener('pong', (event) => this.#ws?.pong?.(toBunSocket(socket, this), event.data));
        });
    }
    #wss: WebSocketServer;
    #server: http.Server;
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
        const addrinfo = this.#server.address();
        const port = typeof addrinfo === 'string' ? -1 : addrinfo?.port!;
        return port === -1 ? undefined as unknown as number : port;
    }
    id: string;
    url: URL;
    protocol: string; //? see note in constructor
    pendingRequests = 0;
    pendingWebSockets = 0;
    fetch(request: string | Request): Response | Promise<Response> {
        if (typeof request === 'string') request = new Request(request);
        return this.#onRequest(request, this) as Response | Promise<Response>;
    }
    publish(topic: string, data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer, compress?: boolean): number {
        this.#wss.clients.forEach((client) => {
            if (client.readyState !== 1) return;
            const bunSocket = Reflect.get(client, '@@asBunSocket') as BunSocket<T> | undefined;
            if (!bunSocket) throw new Error('Internal error: Expected client to have a BunSocket reference');
            if (bunSocket.isSubscribed(topic)) bunSocket.send(data, compress);
        });
        return 0;
    }
    upgrade<T = undefined>(request: Request, options?: { headers?: HeadersInit; data?: T; }): boolean {
        return Reflect.get(request, requestUpgradedSymbol) ?? false;
    }
    requestIP(request: Request): SocketAddress | null {
        const addrinfo = Reflect.get(request, requestRemoteIPSymbol) as AddressInfo & { family: 'IPv4' | 'IPv6'; } | undefined;
        if (addrinfo) return addrinfo;
        else return null;
    }
    reload(options: Serve): void {
        this.#onRequest = options.fetch ?? this.#onRequest;
        this.#onError = options.error ?? this.#onError;
    }
    stop(closeActiveConnections?: boolean): void {
        this.#closed = true;
        if (closeActiveConnections) this.#wss.clients.forEach((client) => client.close());
        this.#wss.close();
        this.#server.close();
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

class BunSocket<T extends any> implements ServerWebSocket {
    #ws: WebSocket;
    #server: Server<T>;
    constructor(socket: WebSocket, server: Server<T>) {
        this.#ws = socket;
        this.#server = server;
        Reflect.set(socket, '@@asBunSocket', this);
    }
    send(data: string | BufferSource, compress?: boolean | undefined): number {
        this.#ws.send(data);
        return typeof data === 'string' ? Buffer.byteLength(data, 'utf8') : data.byteLength;
    }
    sendText(data: string, compress?: boolean | undefined): number {
        this.#ws.send(data);
        return Buffer.byteLength(data, 'utf8');
    }
    sendBinary(data: BufferSource, compress?: boolean | undefined): number {
        this.#ws.send(data);
        return data.byteLength;
    }
    close(code?: number | undefined, reason?: string | undefined): void {
        this.#ws.close(code, reason);
    }
    terminate(): void {
        this.#ws.terminate();
    }
    ping(data?: string | BufferSource | undefined): number {
        this.#ws.ping(data);
        return typeof data === 'string' ? Buffer.byteLength(data, 'utf8') : data?.byteLength ?? 0;
    }
    pong(data?: string | BufferSource | undefined): number {
        this.#ws.pong(data);
        return typeof data === 'string' ? Buffer.byteLength(data, 'utf8') : data?.byteLength ?? 0;
    }
    publish(topic: string, data: string | BufferSource, compress?: boolean | undefined): number {
        return this.#server.publish(topic, data, compress);
    }
    publishText(topic: string, data: string, compress?: boolean | undefined): number {
        return this.publish(topic, data, compress);
    }
    publishBinary(topic: string, data: BufferSource, compress?: boolean | undefined): number {
        return this.publish(topic, data, compress);
    }
    subscribe(topic: string): void {
        this.#subscribedTopics.add(topic);
    }
    unsubscribe(topic: string): void {
        this.#subscribedTopics.delete(topic);
    }
    isSubscribed(topic: string): boolean {
        return this.#subscribedTopics.has(topic);
    }
    cork(callback: (ws: ServerWebSocket<T>) => T): T {
        return callback(this);
    }
    get remoteAddress(): string {
        return this.#ws.url;
    };
    get readyState(): WebSocketReadyState {
        return this.#ws.readyState;
    };
    #subscribedTopics = new Set<string>();
    binaryType?: 'nodebuffer' | 'arraybuffer' | 'uint8array' | undefined;
    // @ts-expect-error generic mess
    data: T;
}

function toBunSocket<T>(socket: WebSocket, server: Server<T>) {
    return new BunSocket<T>(socket, server);
}

import type Bun from 'bun';
import net from 'node:net';

export function listen<T = undefined>(options: Bun.TCPSocketListenOptions<T>): Bun.TCPSocketListener<T>;
export function listen<T = undefined>(options: Bun.UnixSocketOptions<T>): Bun.UnixSocketListener<T>;
export function listen<T = undefined>(options: Bun.TCPSocketListenOptions<T> | Bun.UnixSocketOptions<T>): Bun.TCPSocketListener<T> | Bun.UnixSocketListener<T> {
    if ('unix' in options) return new UnixSocketListener<T>(options);
    else return new TCPSocketListener<T>(options);
}
listen satisfies typeof Bun.listen;

class SocketListener<T = undefined> extends net.Server implements Bun.SocketListener<T> {
    constructor(options: Bun.TCPSocketListenOptions<T> | Bun.UnixSocketOptions<T>) {
        super();
        this.data = options.data!;
        
        this.on('drop', (data) => {
            const socket = new net.Socket();
            if (data) {
                Object.defineProperty(socket, 'localPort', { value: data.localPort });
                Object.defineProperty(socket, 'localFamily', { value: data.localFamily });
                Object.defineProperty(socket, 'localAddress', { value: data.localAddress });
                Object.defineProperty(socket, 'remotePort', { value: data.remotePort });
                Object.defineProperty(socket, 'remoteFamily', { value: data.remoteFamily });
                Object.defineProperty(socket, 'remoteAddress', { value: data.remoteAddress });
            }
            if (options.socket.connectError) options.socket.connectError(toBunSocket<T>(socket), new Error('Connection dropped'));
            else throw new Error('Connection dropped');
        });

        this.on('connection', (socket) => {
            this.#connections.add(socket);
            socket.on('close', () => {
                options.socket.close?.(toBunSocket<T>(socket));
                this.#connections.delete(socket);
            });
            if (options.socket.error) socket.on('error', (err) => options.socket.error!(toBunSocket<T>(socket), err));
            if (options.socket.end) socket.on('end', () => options.socket.end!(toBunSocket<T>(socket)));
            if (options.socket.drain) socket.on('drain', () => options.socket.drain!(toBunSocket<T>(socket)));
            if (options.socket.data) socket.on('data', (buf) => {
                let data: SharedArrayBuffer | ArrayBuffer | Uint8Array | Buffer = buf;
                if (options.socket.binaryType === 'arraybuffer') data = buf.buffer;
                else if (options.socket.binaryType === 'uint8array') data = new Uint8Array(buf.buffer);
                options.socket.data!(toBunSocket<T>(socket), data as Buffer);
            });
            if (options.socket.open) socket.on('ready', () => options.socket.open!(toBunSocket<T>(socket)));
            if (options.socket.timeout) socket.on('timeout', () => options.socket.timeout!(toBunSocket<T>(socket)));
            if (options.socket.handshake) throw new Error('Handshake not implemented'); // tls.TLSSocket 'secureConnection' event
        });

        if ('unix' in options) this.listen(options.unix);
        else this.listen(options.port, options.hostname);
    }
    #connections: Set<net.Socket> = new Set();

    stop(closeActiveConnections?: boolean): void {
        if (closeActiveConnections) {
            this.#connections.forEach((socket) => socket.destroy());
        }
        this.close();
    }
    reload(options: Pick<Partial<Bun.SocketOptions<unknown>>, 'socket'>): void {
        // TODO
        // This more or less just acts as a configuration changer, which node sockets can do on the fly without a full reload.
        throw new Error('Method not implemented.');
    }
    data: T;
}

export class TCPSocketListener<T = undefined> extends SocketListener<T> implements Bun.TCPSocketListener<T> {
    get port(): number {
        const addrinfo = this.address();
        if (addrinfo === null) return NaN;
        if (typeof addrinfo === 'string') return Number(addrinfo.split(':').at(-1));
        else return addrinfo.port;
    }
    get hostname(): string {
        const addrinfo = this.address();
        if (addrinfo === null) return '';
        if (typeof addrinfo === 'string') return addrinfo.split(':')[0];
        else return addrinfo.address;
    }
}

export class UnixSocketListener<T = undefined> extends SocketListener<T> implements Bun.UnixSocketListener<T> {
    get unix(): string {
        const addrinfo = this.address();
        if (addrinfo === null) return '';
        if (typeof addrinfo === 'string') return addrinfo;
        else return addrinfo.address + ':' + addrinfo.port;
    }
};

// TODO
function toBunSocket<T>(socket: net.Socket) {
    return socket as unknown as Bun.Socket<T>;
}

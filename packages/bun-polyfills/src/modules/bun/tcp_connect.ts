import type Bun from 'bun';
import net from 'node:net';

export async function connect<T = undefined>(options: Bun.TCPSocketConnectOptions<T> | Bun.UnixSocketOptions<T>): Promise<Bun.Socket<T>> {
    return new Socket<T>(options);
}
connect satisfies typeof Bun.connect;

export class Socket<T = undefined> extends net.Socket implements Bun.Socket<T> {
    constructor(options: Bun.TCPSocketConnectOptions<T> | Bun.UnixSocketOptions<T>) {
        super();
        this.data = options.data!;
        try {
            if (options.socket.close) this.on('close', (hadError) => options.socket.close!(this));
            if (options.socket.error) this.on('error', (err) => options.socket.error!(this, err));
            if (options.socket.end) this.on('end', () => options.socket.end!(this));
            if (options.socket.drain) this.on('drain', () => options.socket.drain!(this));
            if (options.socket.data) this.on('data', (buf) => {
                let data: SharedArrayBuffer | ArrayBuffer | Uint8Array | Buffer = buf;
                if (options.socket.binaryType === 'arraybuffer') data = buf.buffer;
                else if (options.socket.binaryType === 'uint8array') data = new Uint8Array(buf.buffer);
                options.socket.data!(this, data as Buffer);
            });
            if (options.socket.open) this.on('ready', () => options.socket.open!(this));
            if (options.socket.timeout) this.on('timeout', () => options.socket.timeout!(this));
            if (options.socket.handshake) throw new Error('Handshake not implemented'); // tls.TLSSocket 'secureConnection' event

            if ('unix' in options) this.connect({ path: options.unix });
            else this.connect({ port: options.port, host: options.hostname }); // TODO: options.tls
        } catch (err) {
            if (options.socket.connectError) options.socket.connectError(this, err as Error);
            throw err;
        }
    }
    shutdown(halfClose?: boolean): void {
        this.allowHalfOpen = halfClose ?? false;
        this.end();
    }
    flush(): void { /* no-op */ }
    reload(handler: Bun.SocketHandler<unknown, 'buffer'>): void {
        // TODO
        // This more or less just acts as a configuration changer, which node sockets can do on the fly without a full reload.
        throw new Error('Method not implemented.');
    }
    // @ts-expect-error impossible to make TS happy here, it gets torn between "extends net.Socket" and "implements Bun.Socket"
    override write(data: string | BufferSource, byteOffset: number = 0, byteLength?: number): number {
        const toWrite = typeof data === 'string'
            ? data.substr(byteOffset, byteLength)
            : new Uint8Array(
                ('buffer' in data ? data.buffer.slice(data.byteOffset, data.byteLength) : data).slice(byteOffset, byteLength && byteOffset + byteLength)
            );
        return super.write(toWrite), toWrite.length;
    }
    // @ts-expect-error impossible to make TS happy here, it gets torn between "extends net.Socket" and "implements Bun.Socket"
    override end(data?: string | BufferSource, byteOffset?: number, byteLength?: number): number;
    // @ts-expect-error ^
    override end(): void;
    // @ts-expect-error ^
    override end(data?: string | BufferSource, byteOffset: number = 0, byteLength?: number): number | void {
        if (!data) return void super.end();
        const toWrite = typeof data === 'string'
            ? data.substr(byteOffset, byteLength)
            : new Uint8Array(
                ('buffer' in data ? data.buffer.slice(data.byteOffset, data.byteLength) : data).slice(byteOffset, byteLength && byteOffset + byteLength)
            );
        return super.end(toWrite), toWrite.length;
    }
    // @ts-expect-error impossible to make TS happy here, it gets torn between "extends net.Socket" and "implements Bun.Socket"
    override timeout(seconds: number): void {
        super.setTimeout(seconds * 1000);
    }
    // @ts-expect-error impossible to make TS happy here, it gets torn between "extends net.Socket" and "implements Bun.Socket"
    get readyState(): 'open' | 'closing' | 'closed' {
        if (
            super.readyState === 'open' ||
            super.readyState === 'readOnly' ||
            super.readyState === 'writeOnly'
        ) return 'open';
        else return 'closed';
    }
    declare remoteAddress: string;
    declare localPort: number;
    data: T;
}

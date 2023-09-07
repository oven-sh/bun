import fs from 'node:fs';
import { SystemError } from '../../utils/errors.js';
import type { FileSink as BunFileSink } from 'bun';

export class FileSink implements BunFileSink {
    constructor(fdOrPathOrStream: number | string | NodeJS.WritableStream) {
        if (typeof fdOrPathOrStream === 'string') try {
            this.#fd = fs.openSync(fdOrPathOrStream, 'a+');
            fs.ftruncateSync(this.#fd, 0);
        } catch (err) {
            throw err as SystemError;
        }
        else if (typeof fdOrPathOrStream === 'number') {
            this.#fd = fdOrPathOrStream; // hope this fd is writable
            fs.ftruncateSync(this.#fd, 0);
        }
        else {
            this.#stream = fdOrPathOrStream;
        }
    }
    #fd: number = NaN;
    #stream: NodeJS.WritableStream | undefined;
    #closed: boolean = false;
    #writtenSinceFlush: number = 0;
    #totalWritten: number = 0;

    start(options?: { highWaterMark?: number | undefined; } | undefined): void {
        return; // TODO
    }

    ref(): void {
        return; // TODO
    }

    unref(): void {
        return; // TODO
    }

    write(chunk: string | ArrayBufferView | SharedArrayBuffer | ArrayBuffer): number {
        if (this.#closed) {
            return typeof chunk === 'string' ? chunk.length : chunk.byteLength;
        }
        if (this.#stream) {
            let data;
            if (chunk instanceof ArrayBuffer || chunk instanceof SharedArrayBuffer) data = new Uint8Array(chunk);
            else if (!(chunk instanceof Uint8Array) && typeof chunk !== 'string') data = new Uint8Array(chunk.buffer);
            else data = chunk;
            this.#stream.write(data);
            const written = typeof data === 'string' ? data.length : data.byteLength;
            this.#totalWritten += written;
            return written;
        }
        if (typeof chunk === 'string') {
            fs.appendFileSync(this.#fd, chunk, 'utf8');
            this.#writtenSinceFlush += chunk.length;
            return chunk.length;
        }
        if (chunk instanceof ArrayBuffer || chunk instanceof SharedArrayBuffer) fs.appendFileSync(this.#fd, new Uint8Array(chunk));
        else fs.appendFileSync(this.#fd, new Uint8Array(chunk.buffer));
        this.#writtenSinceFlush += chunk.byteLength;
        return chunk.byteLength;
    }

    //! flushing after writing to a closed FileSink segfaults in Bun but I don't see the need to implement that behavior
    flush(): number | Promise<number> {
        if (this.#closed) return 0;
        // no-op because this is a synchronous implementation
        const written = this.#writtenSinceFlush;
        this.#writtenSinceFlush = 0;
        return written;
    }

    //! not sure what to do with this error
    end(error?: Error): number | Promise<number> {
        if (this.#closed) return this.#totalWritten;
        const flushed = this.flush();
        if (this.#stream) {
            this.#stream.end();
            this.#closed = true;
            return flushed;
        }
        this.#totalWritten = fs.fstatSync(this.#fd).size;
        fs.closeSync(this.#fd);
        this.#closed = true;
        return flushed;
    }
}

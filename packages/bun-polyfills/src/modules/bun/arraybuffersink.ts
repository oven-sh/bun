type BunArrayBufferSink = InstanceType<typeof Bun.ArrayBufferSink>;

export class ArrayBufferSink implements BunArrayBufferSink {
    #started: boolean = true;
    #closed: boolean = false;
    #offset: number = 0;
    #stream: boolean = false;
    #asUint8: boolean = false;
    #buffer: Buffer = Buffer.allocUnsafe(8192);

    get sinkId(): number { return 0; } //? undocumented, seems to always return 0

    #ASSERT_NOT_CLOSED(caller: AnyFunction): void {
        if (!this.#closed) return;
        const err = new TypeError('Expected Sink');
        Error.captureStackTrace(err, caller);
        throw err;
    }

    start({ asUint8Array = false, highWaterMark = 8192, stream = false }: Parameters<BunArrayBufferSink['start']>[0] = {}): void {
        this.#ASSERT_NOT_CLOSED(this.start);
        this.#started = true;
        this.#offset = 0;
        this.#stream = stream;
        this.#asUint8 = asUint8Array;
        if (highWaterMark !== this.#buffer.byteLength) this.#buffer = Buffer.allocUnsafe(highWaterMark);
    }

    write(data: string | ArrayBufferView | SharedArrayBuffer | ArrayBuffer): number {
        this.#ASSERT_NOT_CLOSED(this.write);
        if (typeof data === 'string') data = new TextEncoder().encode(data);
        const writedata = (data instanceof ArrayBuffer || data instanceof SharedArrayBuffer) ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        // this is very bad API design to not throw an error here, but it's what Bun does
        if (!this.#started) return writedata.byteLength;

        if (this.#offset + writedata.byteLength > this.#buffer.byteLength) {
            const newLength = Math.ceil((this.#offset + writedata.byteLength) / 1024) * 1024;
            const newBuffer = Buffer.allocUnsafe(newLength);
            newBuffer.set(this.#buffer);
            this.#buffer = newBuffer;
        }
        this.#buffer.set(writedata, this.#offset);
        this.#offset += writedata.byteLength;
        return writedata.byteLength;
    }

    flush(): number | Uint8Array | ArrayBuffer {
        this.#ASSERT_NOT_CLOSED(this.flush);
        if (!this.#stream) return 0; //! brokenly seems to always return 0 and do nothing
        const flushed = new Uint8Array(this.#offset);
        flushed.set(this.#buffer.subarray(0, this.#offset)); // faster than Buffer.copy or Uint8Array.slice
        this.#offset = 0;
        return this.#asUint8 ? flushed : flushed.buffer as ArrayBuffer;
    }

    end(): Uint8Array | ArrayBuffer {
        this.#ASSERT_NOT_CLOSED(this.end);
        const stream = this.#stream;
        this.#stream = true; // force flush() to return the data
        const buffer = this.flush() as Uint8Array | ArrayBuffer;
        this.#stream = stream;
        this.#started = false;
        return buffer;
    }

    close(): void { this.#closed = true; } //? undocumented
}

import streams from 'node:stream';

export const getter = <T>(obj: T, key: string | symbol, get: () => any, enumerable = false, configurable = true): void => {
    Object.defineProperty(obj, key, { get, configurable, enumerable });
};

export const setter = <T>(obj: T, key: string | symbol, set: () => any, enumerable = false, configurable = true): void => {
    Object.defineProperty(obj, key, { set, configurable, enumerable });
};

export const readonly = <T>(obj: T, key: string | symbol, value: unknown, enumerable = false, configurable = true): void => {
    Object.defineProperty(obj, key, { value, configurable, enumerable });
};

export function streamToBuffer(stream: streams.Readable | streams.Duplex): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const buffers: Uint8Array[] = [];
        stream.on("data", (chunk: Uint8Array) => buffers.push(chunk));
        stream.on("end", () => resolve(Buffer.concat(buffers)));
        stream.on("error", (err: Error) => reject(err));
    });
}

export function isArrayBufferView(value: any): value is ArrayBufferView {
    return value !== null && typeof value === 'object' && 
        value.buffer instanceof ArrayBuffer && typeof value.byteLength === 'number' && typeof value.byteOffset === 'number';
}

export function toWebReadableStream(stream: streams.Readable): ReadableStream<any> {
    return streams.Readable.toWeb(stream) as ReadableStream<any>;
}

export function fromWebReadableStream(stream: ReadableStream): streams.Readable {
    return streams.Readable.fromWeb(stream) as streams.Readable;
}

export function toWebWritableStream(stream: streams.Writable): WritableStream {
    return streams.Writable.toWeb(stream) as WritableStream;
}

export function fromWebWritableStream(stream: WritableStream): streams.Writable {
    return streams.Writable.fromWeb(stream) as streams.Writable;
}

export function toWebDuplexStream(stream: streams.Duplex):  { readable: ReadableStream, writable: WritableStream } {
    return streams.Duplex.toWeb(stream) as { readable: ReadableStream, writable: WritableStream };
}

export function fromWebDuplexStream(pair: { readable: ReadableStream, writable: WritableStream }): streams.Duplex {
    return streams.Duplex.fromWeb(pair, {}) as streams.Duplex;
}

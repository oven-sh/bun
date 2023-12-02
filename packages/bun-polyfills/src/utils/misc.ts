import streams from 'node:stream';
import type { SpawnOptions, FileBlob } from 'bun';

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

export function isOptions(options: any): options is SpawnOptions.OptionsObject {
    return options !== null && typeof options === 'object';
}

export function isFileBlob(blob: any): blob is FileBlob {
    return blob instanceof Blob && Reflect.get(blob, 'readable') instanceof ReadableStream && typeof Reflect.get(blob, 'writer') === 'function';
}

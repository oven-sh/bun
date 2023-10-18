import type { BunFile } from 'bun';
import { version, readableStreamToFormData } from '../modules/bun.js';
import './console.js';
import './process.js';
import os from 'node:os';

//? NodeJS Blob doesn't implement these, so we need to polyfill them.
Blob.prototype.json = async function json<T>(this: Blob): Promise<T> {
    try {
        return JSON.parse(await this.text()) as T;
    } catch (err) {
        Error.captureStackTrace(err as Error, json);
        throw err;
    }
};
Blob.prototype.formData = async function formData(this: Blob): Promise<FormData> {
    if (this.type.startsWith('multipart/form-data;')) {
        return new Response(this.stream(), { headers:
            //? Good one Node: https://github.com/nodejs/node/issues/42266
            { 'Content-Type': this.type.replace('webkitformboundary', 'WebkitFormBoundary') }
        }).formData() as Promise<FormData>;
    } else if (this.type === 'application/x-www-form-urlencoded') {
        return readableStreamToFormData(this.stream());
    } else {
        throw new TypeError('Blob type is not well-formed multipart/form-data or application/x-www-form-urlencoded');
    }
}
Reflect.set(Blob.prototype, 'readable', undefined /*satisfies BunFile['readable']*/);
Reflect.set(Blob.prototype, 'lastModified', -1 satisfies BunFile['lastModified']);
Reflect.set(Blob.prototype, 'exists', (async function exists() {
    return true;
}) satisfies BunFile['exists']);
Reflect.set(Blob.prototype, 'writer', (function writer() {
    throw new TypeError('Blob is detached');
}) satisfies BunFile['writer']);

//? NodeJS File doesn't implement these either
File.prototype.json = Blob.prototype.json;
File.prototype.formData = Blob.prototype.formData;

//? navigator global object polyfill
Reflect.set(globalThis, 'navigator', {
    userAgent: `Bun/${version}`,
    hardwareConcurrency: os.cpus().length,
});

//? method only available in Bun
// this isn't quite accurate, but it shouldn't break anything and is currently here just for matching bun and node types
const ReadableStreamDefaultReaderPrototype = Object.getPrototypeOf(new ReadableStream().getReader());
Reflect.set(
    ReadableStreamDefaultReaderPrototype, 'readMany',
    function readMany(this: ReadableStreamDefaultReader): Promise<ReadableStreamDefaultReadManyResult<any>> {
        return new Promise((resolve, reject) => {
            const result: ReadableStreamDefaultReadManyResult<any> = {
                value: [],
                size: 0,
                done: true
            };
            this.read().then(({ done, value }) => {
                if (done) resolve(result);
                else {
                    result.value.push(value);
                    result.size = value.length;
                    result.done = false;
                    resolve(result);
                }
            }, reject);
        });
    }
);

import { version } from '../modules/bun.js';
import './console.js';
import './process.js';
import os from 'node:os';

//? NodeJS Blob doesn't implement Blob.json(), so we need to polyfill it.
Blob.prototype.json = async function json(this: Blob) {
    try {
        return JSON.parse(await this.text()) as unknown;
    } catch (err) {
        Error.captureStackTrace(err as Error, json);
        throw err;
    }
};

//? navigator global object polyfill
Reflect.set(globalThis, 'navigator', {
    userAgent: `Bun/${version}`,
    hardwareConcurrency: os.cpus().length,
});

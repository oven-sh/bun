import fs from 'node:fs';
import tty from 'node:tty';
import streams from 'node:stream';
import { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import { FileSink } from './filesink.js';
import { SystemError } from '../../utils/errors.js';
import type { BunFile, FileBlob as BunFileBlob, FileSink as BunFileSink } from 'bun';

type NodeJSStream = streams.Readable | streams.Writable;

function NodeJSReadableStreamToBlob(stream: NodeJS.ReadableStream | NodeJS.ReadWriteStream, iostream: boolean = false, type?: string): Promise<Blob> {
    if (stream.isPaused()) stream.resume();
    return new Promise((resolve, reject) => {
        const chunks: any[] = [];
        const dataHandler = (chunk: any) => { chunks.push(chunk); if (iostream) end(); };
        const end = () => {
            resolve(new Blob(chunks, type != null ? { type } : undefined));
            stream.off('data', dataHandler);
            stream.off('end', end);
            stream.pause();
        };
        stream.once('data', dataHandler).once('end', end);
        //.once('error', reject); Bun waits to error on actual operations on the stream, therefore so will we.
    });
}

export const NodeJSStreamFileBlob = class FileBlob extends Blob {
    constructor(source: NodeJSStream, slice: [number?, number?] = [undefined, undefined], type = 'application/octet-stream') {
        super(undefined, { type });
        Reflect.deleteProperty(this, 'size');
        Object.defineProperty(this, '@@isFileBlob', { value: true });
        if (source === process.stdout || source === process.stdin || source === process.stderr) {
            this.#iostream = true;
        }
        this.#readable = source instanceof streams.Readable && !(source instanceof tty.WriteStream);
        this.#source = source;
        this.#slice = slice;
        this.#size = Infinity;
    }
    readonly #iostream: boolean = false;
    readonly #readable: boolean;
    readonly #source: NodeJSStream;
    readonly #slice: [number?, number?];
    #size: number;

    slice(begin?: number, end?: number, contentType?: string): BunFile;
    slice(begin?: number, contentType?: string): BunFile;
    slice(contentType?: string): BunFile;
    slice(beginOrType?: number | string, endOrType?: number | string, contentType: string = this.type): BunFile {
        if (typeof beginOrType === 'string') return new FileBlob(this.#source, this.#slice, beginOrType);
        if (typeof endOrType === 'string') return new FileBlob(this.#source, [beginOrType, undefined], endOrType);
        return new FileBlob(this.#source, [beginOrType, endOrType], contentType);
    }

    override stream(): ReadableStream<Uint8Array> {
        // This makes no sense but Bun does it so we will too
        if (!this.#readable) return new ReadableStream();
        return streams.Readable.toWeb(this.#source as streams.Readable);
    }

    #blobStackFn: AnyFunction = this.#getBlob;

    async #getBlob(): Promise<Blob> {
        if (!this.#readable) {
            const err = new SystemError(-1, 'read');
            Error.captureStackTrace(err, this.#blobStackFn);
            throw err;
        }
        const blob = (await NodeJSReadableStreamToBlob(this.#source as streams.Readable, this.#iostream)).slice(...this.#slice);
        this.#size = blob.size;
        return blob;
    }

    override async text(): Promise<string> {
        if (this.#blobStackFn !== this.json) this.#blobStackFn = this.text;
        return (await this.#getBlob()).text();
    }
    override async arrayBuffer(): Promise<ArrayBuffer> {
        this.#blobStackFn = this.arrayBuffer;
        return (await this.#getBlob()).arrayBuffer();
    }
    override async json<TJSONReturnType = unknown>(): Promise<TJSONReturnType> {
        this.#blobStackFn = this.json;
        return JSON.parse(await this.text()) as Promise<TJSONReturnType>;
    }

    readonly lastModified: number = Date.now();
    readable: ReadableStream<any> = undefined as any; //? broken on bun's side

    async exists(): Promise<boolean> {
        return false; // Yes Bun returns false for these at the time of writing
    }

    writer(): BunFileSink {
        if (!this.#readable && !this.#iostream) throw new Error('Cannot get writer for a non-readable stream');
        // @ts-expect-error stream types are just too annoying to make TS happy here but it works at runtime
        return new FileSink(this.#source);
    }

    override get size(): number { return this.#size; }
    override set size(_) { return; }
};

export class FileBlob extends Blob implements BunFileBlob {
    constructor(fdOrPath: number | string | URL, opts: BlobPropertyBag = {}) {
        opts.type ??= 'application/octet-stream'; // TODO: Get MIME type from file extension
        super(undefined, opts);
        Reflect.deleteProperty(this, 'size');
        Object.defineProperty(this, '@@isFileBlob', { value: true });
        const slice = Reflect.get(opts, '__slice') as [number?, number?] | undefined;
        if (slice) {
            slice[0] &&= slice[0] | 0; // int cast
            slice[1] &&= slice[1] | 0; // int cast
            this.#slice = slice;
            slice[0] ??= 0;
            if (typeof slice[1] === 'undefined') {
                if (slice[0] < 0) this.#sliceSize = -slice[0];
            }
            else if (slice[0] < 0 && slice[1] < 0) this.#sliceSize = -(slice[0] - slice[1]);
            else if (slice[0] >= 0 && slice[1] >= 0) this.#sliceSize = slice[1] - slice[0];
            Object.defineProperty(this, '@@writeSlice', { value: this.#sliceSize - slice[0] });
        }
        this.#fdOrPath = fdOrPath;
        this.#instancedTime = Date.now();
        try {
            this.#instancedSize = typeof this.#fdOrPath === 'number'
                ? fs.fstatSync(this.#fdOrPath).size
                : fs.statSync(this.#fdOrPath).size;
        } catch {
            this.#instancedSize = 0;
        }
        this.name = typeof fdOrPath === 'string' ? fdOrPath : (
            // for now, this seems to be what Bun does, but this is problematic for Windows, so we'll see how this goes
            fdOrPath instanceof URL ? fdOrPath.pathname : undefined
        );
    }
    readonly #instancedTime: number;
    readonly #instancedSize: number;
    readonly #slice: [number?, number?] = [];
    readonly #sliceSize: number = 0;
    #fdOrPath: string | number | URL;
    readonly name?: string;

    //! package-internal use only
    protected ['@@toStream']() {
        const fd = typeof this.#fdOrPath === 'number' ? this.#fdOrPath : fs.openSync(this.#fdOrPath, 'w+');
        const wstream = fs.createWriteStream('', { fd, start: this.#slice[0] });
        return wstream;
    }

    #read(): Blob {
        const read = fs.readFileSync(this.#fdOrPath);
        return new Blob([read.subarray(...this.#slice)], { type: this.type });
    }

    //! Bun seems to return undefined for this, this might not be accurate or it's broken on Bun's side
    get readable(): ReadableStream<any> {
        return undefined as any;
        //const fd = typeof this.#pathlikeOrFd === 'number' ? this.#pathlikeOrFd : fs.openSync(this.#pathlikeOrFd, 'r');
        //const rstream = fs.createReadStream('', { fd, start: this.#slice[0], end: this.#slice[1] });
        //return streams.Readable.toWeb(rstream);
    }

    get lastModified(): number {
        try {
            return typeof this.#fdOrPath === 'number'
                ? fs.fstatSync(this.#fdOrPath).mtimeMs
                : fs.statSync(this.#fdOrPath).mtimeMs;
        } catch {
            return this.#instancedTime; // Bun seems to fallback to when the Bun.file was created
        }
    }

    async exists(): Promise<boolean> {
        try {
            if (typeof this.#fdOrPath !== 'number') return fs.statSync(this.#fdOrPath).isFile();
            return fs.fstatSync(this.#fdOrPath).isFile();
        } catch {
            return false;
        }
    }

    writer(): BunFileSink {
        const fdOrPath = this.#fdOrPath;
        return new FileSink(typeof fdOrPath === 'string' || fdOrPath instanceof URL ? fs.openSync(fdOrPath, 'w+') : fdOrPath);
    }

    // TODO: what's contentType?
    override slice(begin?: number | string, end?: number | string, contentType?: string): FileBlob {
        if (typeof begin === 'string') {
            contentType = begin;
            begin = undefined;
        }
        if (typeof end === 'string') {
            contentType = end;
            end = undefined;
        }
        return new FileBlob(this.#fdOrPath, {
            __slice: [begin, end],
        } as BlobPropertyBag);
    }
    override arrayBuffer(): Promise<ArrayBuffer> {
        return new Blob([this.#read() ?? '']).arrayBuffer();
    }
    override text(): Promise<string> {
        return new Blob([this.#read() ?? '']).text();
    }
    override json(): Promise<any>;
    override json<TJSONReturnType = unknown>(): Promise<TJSONReturnType>;
    override json<TJSONReturnType = unknown>(): Promise<TJSONReturnType> | Promise<any> {
        return new Blob([this.#read() ?? '']).json();
    }
    override stream(): NodeJS.ReadableStream;
    override stream(): ReadableStream<Uint8Array>;
    override stream(): ReadableStream<Uint8Array> | NodeJS.ReadableStream {
        return new Blob([this.#read() ?? '']).stream();
    }

    override get size(): number {
        return this.#instancedSize <= (this.#sliceSize || 0) ? this.#sliceSize : this.#instancedSize;
    }
}

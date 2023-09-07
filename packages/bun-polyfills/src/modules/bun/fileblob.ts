import fs from 'node:fs';
import tty from 'node:tty';
import streams from 'node:stream';
import { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import { FileSink } from './filesink.js';
import { SystemError } from '../../utils/errors.js';
import type { FileBlob as BunFileBlob, FileSink as BunFileSink } from 'bun';

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

    slice(begin?: number, end?: number, contentType?: string): Blob;
    slice(begin?: number, contentType?: string): Blob;
    slice(contentType?: string): Blob;
    slice(beginOrType?: number | string, endOrType?: number | string, contentType: string = this.type): Blob {
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

    override get size(): number { return this.#size; }
    override set size(_) { return; }
};

export class FileBlob extends Blob implements BunFileBlob {
    constructor(fdOrPath: number | string, opts: BlobPropertyBag = {}) {
        opts.type ??= 'application/octet-stream'; // TODO: Get MIME type from file extension
        super(undefined, opts);
        Reflect.deleteProperty(this, 'size');
        if (Reflect.get(opts, '__data')) this.#data = Reflect.get(opts, '__data') as Blob;
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
        } 
        if (typeof fdOrPath === 'string') try {
            this.#fd = fs.openSync(fdOrPath, 'r+');
        } catch (err) {
            this.#error = err as SystemError;
        }
        else {
            this.#fd = fdOrPath;
            this.#error = Reflect.get(opts, '__error') as SystemError | undefined;
        }
        if (!this.#error) {
            const rstream = fs.createReadStream('', { fd: this.#fd, start: this.#slice[0], end: this.#slice[1] });
            this.#readable = streams.Readable.toWeb(rstream);
        }
    }
    readonly #readable?: NodeWebReadableStream;
    readonly #error?: SystemError;
    readonly #slice: [number?, number?] = [];
    readonly #sliceSize: number = 0;
    readonly #fd: number = NaN;
    #data?: Blob;

    #read() {
        if (this.#error) throw this.#error;
        const read = fs.readFileSync(this.#fd);
        this.#data = new Blob([read.subarray(...this.#slice)], { type: this.type });
    }

    //! Bun 0.2 seems to return undefined for this, this might not be accurate or it's broken on Bun's side
    get readable(): ReadableStream<any> {
        if (this.#error) throw this.#error;
        return this.#readable! as ReadableStream;
    }

    get lastModified(): number {
        if (this.#error) throw this.#error;
        return fs.fstatSync(this.#fd).mtimeMs;
    }

    async exists(): Promise<boolean> {
        return !this.#error;
    }

    writer(): BunFileSink {
        if (this.#error) throw this.#error;
        return new FileSink(this.#fd);
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
        return new FileBlob(this.#fd, {
            __error: this.#error,
            __slice: [begin, end],
            __data: this.#data?.slice(begin, end),
        } as BlobPropertyBag);
    }
    override arrayBuffer(): Promise<ArrayBuffer> {
        if (!this.#data) this.#read();
        return new Blob([this.#data ?? '']).arrayBuffer();
    }
    override text(): Promise<string> {
        if (!this.#data) this.#read();
        return new Blob([this.#data ?? '']).text();
    }
    override json(): Promise<any>;
    override json<TJSONReturnType = unknown>(): Promise<TJSONReturnType>;
    override json<TJSONReturnType = unknown>(): Promise<TJSONReturnType> | Promise<any> {
        if (!this.#data) this.#read();
        return new Blob([this.#data ?? '']).json();
    }
    override stream(): NodeJS.ReadableStream;
    override stream(): ReadableStream<Uint8Array>;
    override stream(): ReadableStream<Uint8Array> | NodeJS.ReadableStream {
        if (!this.#data) this.#read();
        return new Blob([this.#data ?? '']).stream();
    }

    override get size(): number {
        return this.#data?.size ?? (this.#sliceSize || 0);
    }
}

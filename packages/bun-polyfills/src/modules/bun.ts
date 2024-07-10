import type {
    BunPlugin, PluginConstraints, PluginBuilder, OnLoadCallback, OnResolveCallback, HeapSnapshot,
    EditorOptions, SpawnOptions, Subprocess, SyncSubprocess, FileBlob as BunFileBlob, ArrayBufferView, Hash
} from 'bun';
import { TextDecoderStream } from 'node:stream/web';
import { NotImplementedError, type SystemError } from '../utils/errors.js';
import { streamToBuffer, isArrayBufferView, isFileBlob, isOptions } from '../utils/misc.js';
import dnsPolyfill from './bun/dns.js';
import { FileSink } from './bun/filesink.js';
import {
    bunHash, bunHashProto,
    MD4 as MD4Polyfill, MD5 as MD5Polyfill,
    SHA1 as SHA1Polyfill, SHA224 as SHA224Polyfill,
    SHA256 as SHA256Polyfill, SHA384 as SHA384Polyfill,
    SHA512 as SHA512Polyfill, SHA512_256 as SHA512_256Polyfill
} from './bun/hashes.js';
import { ArrayBufferSink as ArrayBufferSinkPolyfill } from './bun/arraybuffersink.js';
import { FileBlob, NodeJSStreamFileBlob } from './bun/fileblob.js';
import TranspilerImpl from './bun/transpiler.js';
import fs from 'node:fs';
import v8 from 'node:v8';
import path from 'node:path';
import util from 'node:util';
import zlib from 'node:zlib';
import streams from 'node:stream';
import workers from 'node:worker_threads';
import chp, { type ChildProcess, type StdioOptions, type SpawnSyncReturns } from 'node:child_process';
import { fileURLToPath as fileURLToPathNode, pathToFileURL as pathToFileURLNode } from 'node:url';
import npm_which from 'which';
import openEditor from 'open-editor';

export const main = path.resolve(process.cwd(), process.argv[1] ?? 'repl') satisfies typeof Bun.main;

//? These are automatically updated on build by tools/updateversions.ts, do not edit manually.
export const version = '0.7.4' satisfies typeof Bun.version;
export const revision = '56816a3ec845a4b9fc40ade34dbe5c0033433d51' satisfies typeof Bun.revision;

export const gc = (globalThis.gc ? (() => (globalThis.gc!(), process.memoryUsage().heapUsed)) : (() => {
    const err = new Error('[bun-polyfills] Garbage collection polyfills are only available when Node.js is ran with the --expose-gc flag.');
    Error.captureStackTrace(err, gc);
    throw err;
})) satisfies typeof Bun.gc;

//getter(bun, 'cwd', proc.cwd); //! Can't named export a getter
export const origin = '' satisfies typeof Bun.origin;
// @ts-expect-error ---
export const stdin = new NodeJSStreamFileBlob(process.stdin) satisfies typeof Bun.stdin;
// @ts-expect-error ---
export const stdout = new NodeJSStreamFileBlob(process.stdout) satisfies typeof Bun.stdout;
// @ts-expect-error ---
export const stderr = new NodeJSStreamFileBlob(process.stderr) satisfies typeof Bun.stderr;
export const argv = [process.argv0, ...process.execArgv, ...process.argv.slice(1)] satisfies typeof Bun.argv;
export const env = process.env satisfies typeof Bun.env;
Object.setPrototypeOf(env, {
    toJSON(this: typeof env) { return { ...this }; }
});
// @ts-expect-error supports-color types are unbelievably bad
export const enableANSIColors = (await import('supports-color')).createSupportsColor().hasBasic satisfies typeof Bun.enableANSIColors;

export const hash = bunHash satisfies typeof Bun.hash;
Object.setPrototypeOf(hash, bunHashProto satisfies Hash);

export const unsafe = {
    gcAggressionLevel: () => 0, //! no-op
    arrayBufferToString: (buf) => new TextDecoder().decode(buf),
    segfault: () => {
        const segfault = new Error();
        segfault.name = 'SegfaultTest';
        segfault.message = '';
        console.error(segfault);
        process.exit(1);
    }
} satisfies typeof Bun['unsafe'];

export const Transpiler = TranspilerImpl satisfies typeof Bun.Transpiler;

export const SHA1 = SHA1Polyfill satisfies typeof Bun.SHA1;
export const MD5 = MD5Polyfill satisfies typeof Bun.MD5;
export const MD4 = MD4Polyfill satisfies typeof Bun.MD4;
export const SHA224 = SHA224Polyfill satisfies typeof Bun.SHA224;
export const SHA512 = SHA512Polyfill satisfies typeof Bun.SHA512;
export const SHA384 = SHA384Polyfill satisfies typeof Bun.SHA384;
export const SHA256 = SHA256Polyfill satisfies typeof Bun.SHA256;
export const SHA512_256 = SHA512_256Polyfill satisfies typeof Bun.SHA512_256;

export const indexOfLine = ((data, offset) => {
    if (data instanceof ArrayBuffer || data instanceof SharedArrayBuffer) data = new Uint8Array(data);
    if (data instanceof DataView || !(data instanceof Uint8Array)) data = new Uint8Array(data.buffer);
    return data.indexOf(10, offset);
}) satisfies typeof Bun.indexOfLine;

const peek_ = function peek(promise: Parameters<typeof Bun.peek>[0]) {
    throw new NotImplementedError('Bun.peek', peek);
};
peek_.status = (promise => {
    return util.inspect(promise).includes('<pending>') ? 'pending'
        : util.inspect(promise).includes('<rejected>') ? 'rejected' : 'fulfilled';
}) satisfies typeof Bun.peek.status;
export const peek = peek_ satisfies typeof Bun.peek;

export const sleep = (ms => {
    return new Promise(r => setTimeout(r, ms instanceof Date ? ms.valueOf() - Date.now() : ms));
}) satisfies typeof Bun.sleep;
export const sleepSync = (ms => {
    if (ms < 0) throw new TypeError('argument to sleepSync must not be negative');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}) satisfies typeof Bun.sleepSync;

//? This is not 1:1 matching, but no one should be relying on the exact output of this function anyway.
//? To quote Node's inspect itself: "The output of util.inspect() may change at any time and should not be depended upon programmatically."
//? Of course in Node's case some didn't listen and relied on the output of util.inspect() anyway, but hopefully this won't happen with this one.
export const inspect = ((arg: any): string => util.inspect(arg, {
    breakLength: Infinity,
    colors: false,
    compact: true,
    customInspect: false,
    depth: Infinity,
    getters: true,
    maxArrayLength: Infinity,
    maxStringLength: Infinity,
    showHidden: false,
    showProxy: false,
    sorted: false
})) satisfies typeof Bun.inspect;

export const resolveSync = ((id: string, parent: string) => import.meta.resolveSync(id, parent)) satisfies typeof Bun.resolveSync;
export const resolve = (async (id: string, parent: string) => import.meta.resolve!(id, parent)) satisfies typeof Bun.resolve;

//? Yes, this is faster than new Uint8Array(Buffer.allocUnsafe(size).buffer) by about 2.5x in Node.js
export const allocUnsafe = ((size: number) => new Uint8Array(size)) satisfies typeof Bun.allocUnsafe;

export const generateHeapSnapshot = (async (): Promise<HeapSnapshot> => {
    process.emitWarning('The polyfill for Bun.generateHeapShot is asynchronous, unlike the original which is synchronous.', {
        type: 'BunPolyfillWarning',
        code: 'BUN_POLYFILLS_ASYNC_GENERATE_HEAP_SNAPSHOT',
        detail: 'This is due to v8.getHeapSnapshot() returning a stream in Node.js. This is not a bug, but a limitation of the polyfill.'
    });
    const raw = (await streamToBuffer(v8.getHeapSnapshot())).toString('utf8');
    const json = JSON.parse(raw) as V8HeapSnapshot;
    return {
        version: 2,
        type: 'Inspector',
        nodes: json.nodes,
        edges: json.edges,
        edgeTypes: json.snapshot.meta.edge_types.flat(),
        edgeNames: json.snapshot.meta.edge_fields.flat(),
        nodeClassNames: json.snapshot.meta.node_types.flat(),
    };
    // @ts-expect-error Refer to the above emitWarning call
}) satisfies typeof Bun.generateHeapSnapshot;

//! This is a no-op in Node.js, as there is no way to shrink the V8 heap from JS as far as I know.
export const shrink = (() => void 0) satisfies typeof Bun.shrink;

export const openInEditor = ((file: string, opts?: EditorOptions) => {
    const target = [{ file: path.resolve(process.cwd(), file), line: opts?.line, column: opts?.column }] as const;
    if (opts?.editor) openEditor(target, opts);
    else openEditor(target, { editor: process.env.TERM_PROGRAM ?? process.env.VISUAL ?? process.env.EDITOR ?? 'vscode' });
}) satisfies typeof Bun.openInEditor;

export const serve = (() => { throw new NotImplementedError('Bun.serve', serve); }) satisfies typeof Bun.serve;

export const file = ((path: string | URL | Uint8Array | ArrayBufferLike | number, options?: BlobPropertyBag): BunFileBlob => {
    if (typeof path === 'object') throw new NotImplementedError('Bun.file with typed array', file);
    return new FileBlob(path, options);
}) satisfies typeof Bun.file;

export const write = (async (dest: BunFileBlob | PathLike, input: string | Blob | TypedArray | ArrayBufferLike | BlobPart[] | Response | BunFileBlob): ReturnType<typeof Bun.write> => {
    if (!isFileBlob(dest)) {
        let fd: number;
        if (dest instanceof ArrayBuffer || dest instanceof SharedArrayBuffer) fd = fs.openSync(Buffer.from(dest), 'w');
        // bun-types thought it'd be funny to make their own URL definition which doesnt match with the correct URL definition...
        else if (typeof dest === 'string' || dest instanceof URL) fd = fs.openSync(dest as import('url').URL, 'w');
        else fd = fs.openSync(Buffer.from(dest.buffer), 'w');

        if (input instanceof Response || input instanceof Blob) {
            const data = await input.text();
            return new Promise((resolve, reject) => {
                fs.write(fd, data, (err, written) => err ? reject(err) : resolve(written));
            });
        }
        if (Array.isArray(input)) {
            const data = await new Blob(input).text();
            return new Promise((resolve, reject) => {
                fs.write(fd, data, (err, written) => err ? reject(err) : resolve(written));
            });
        }
        return new Promise((resolve, reject) => {
            if (typeof input === 'string') return fs.write(fd, input, (err, written) => err ? reject(err) : resolve(written));
            if (input instanceof Uint8Array) return fs.write(fd, input, (err, written) => err ? reject(err) : resolve(written));
            if (input instanceof ArrayBuffer) return fs.write(fd, new Uint8Array(input), (err, written) => err ? reject(err) : resolve(written));
            if (input instanceof SharedArrayBuffer) return fs.write(fd, new Uint8Array(input), (err, written) => err ? reject(err) : resolve(written));
            return write(dest, String(input)); // if all else fails, it seems Bun tries to convert to string and write that.
        });
    } else {
        const writer = dest.writer();
        if (Array.isArray(input)) input = new Blob(input);
        if (input instanceof Blob || input instanceof Response) return writer.write(await input.arrayBuffer());
        if (input instanceof ArrayBuffer || input instanceof SharedArrayBuffer || ArrayBuffer.isView(input)) return writer.write(input);
        if (typeof input === 'string') return writer.write(input);
        else return write(dest, String(input)); // if all else fails, it seems Bun tries to convert to string and write that.
    }
}) satisfies typeof Bun.write;

export const sha = SHA512_256.hash satisfies typeof Bun.sha;

export const nanoseconds = (() => Math.trunc(performance.now() * 1000000)) satisfies typeof Bun.nanoseconds;

//? This just prints out some debug stuff in console, and as the name implies no one should be using it.
//? But, just in case someone does, we'll make it a no-op function so at least the program doesn't crash trying to run the function.
export const DO_NOT_USE_OR_YOU_WILL_BE_FIRED_mimalloc_dump = (() => {
    console.warn('DO_NOT_USE_OR_YOU_WILL_BE_FIRED_mimalloc_dump called.');
}) satisfies unknown; /* undocumented */

export const gzipSync = zlib.gzipSync satisfies typeof Bun.gzipSync;
export const deflateSync = zlib.deflateSync satisfies typeof Bun.deflateSync;
export const gunzipSync = zlib.gunzipSync satisfies typeof Bun.gunzipSync;
export const inflateSync = zlib.inflateSync satisfies typeof Bun.inflateSync;

export const which = ((cmd: string, options) => {
    const opts: npm_which.Options = { all: false, nothrow: true };
    if (options?.PATH) opts.path = options.PATH;
    const result = npm_which.sync(cmd, opts) as string | null;
    if (!result || !options?.cwd) return result;
    if (path.normalize(result).includes(path.normalize(options.cwd))) return result;
    else return null;
}) satisfies typeof Bun.which;

export const spawn = ((...args) => {
    let cmd: string;
    let argv: string[];
    let opts: SpawnOptions.OptionsObject;

    if (args[0] instanceof Array) {
        cmd = args[0][0];
        argv = args[0].slice(1);
        opts = isOptions(args[1]) ? args[1] : {};
    } else {
        cmd = args[0].cmd[0];
        argv = args[0].cmd.slice(1);
        opts = args[0];
        Reflect.deleteProperty(opts, 'cmd');
    }

    let stdio: StdioOptions = [];
    opts.stdio ??= [undefined, undefined, undefined];
    if (opts.stdin) opts.stdio[0] = opts.stdin;
    if (opts.stdout) opts.stdio[1] = opts.stdout;
    if (opts.stderr) opts.stdio[2] = opts.stderr;
    for (let i = 1; i < 3; i++) { // this intentionally skips stdin
        let std = opts.stdio[i];
        if (isArrayBufferView(std)) stdio[i] = streams.Readable.fromWeb(new Blob([std]).stream());
        else if (std instanceof Blob || isFileBlob(std)) stdio[i] = streams.Readable.fromWeb(std.stream());
        else if (std instanceof ReadableStream) stdio[i] = streams.Readable.fromWeb(std);
        else if (std instanceof Response || std instanceof Request) stdio[i] = streams.Readable.fromWeb(std.body!);
        else stdio[i] = std;
    }
    let stdinSrc: typeof opts.stdio[0] = null;
    if (opts.stdio[0] && typeof opts.stdio[0] !== 'string') {
        stdinSrc = opts.stdio[0];
        stdio[0] = 'pipe';
    }

    const subp = chp.spawn(cmd, argv, {
        cwd: opts.cwd ?? process.cwd(),
        // why is this set to (string | number) on env values...
        env: { ...(opts.env as Record<string, string> ?? process.env) },
        stdio
    }) as unknown as Subprocess;
    const subpAsNode = subp as unknown as ChildProcess;
    const stdstreams = [subpAsNode.stdin, subpAsNode.stdout, subpAsNode.stderr] as const;
    if (subpAsNode.stdout) {
        const rstream = streams.Readable.toWeb(subpAsNode.stdout) as ReadableStream;
        Reflect.set(rstream, 'destroy', function (this: ReadableStream, err?: Error) {
            void (err ? this.cancel(String(err)) : this.cancel()).catch(() => { /* if it fails its already closed */ });
            return this;
        });
        (<Mutable<Subprocess>>subp).stdout = rstream;
    }
    if (subpAsNode.stderr) {
        const rstream = streams.Readable.toWeb(subpAsNode.stderr) as ReadableStream;
        Reflect.set(rstream, 'destroy', function (this: ReadableStream, err?: Error) {
            void (err ? this.cancel(String(err)) : this.cancel()).catch(() => { /* if it fails its already closed */ });
            return this;
        });
        (<Mutable<Subprocess>>subp).stderr = rstream;
    }
    let internalStdinStream: streams.Writable;
    if (subpAsNode.stdin) {
        const wstream = subpAsNode.stdin;
        Reflect.set(wstream, 'destroy', function (this: NodeJS.WritableStream, err?: Error) {
            void this.end(); /* if it fails its already closed */
            return this;
        });
        internalStdinStream = wstream;
        (<Mutable<Subprocess>>subp).stdin = new FileSink(wstream);

    }
    Object.defineProperty(subp, 'readable', { get(this: Subprocess) { return this.stdout; } });
    Object.defineProperty(subp, 'exited', {
        value: new Promise((resolve, reject) => {
            subpAsNode.once('exit', (code) => {
                stdstreams[0]?.destroy();
                stdstreams[1]?.destroy();
                stdstreams[2]?.destroy();
                subp.kill();
                subp.unref();
                subpAsNode.disconnect?.();
                subpAsNode.removeAllListeners();
                resolve(code);
            });
        })
    });
    if (stdinSrc) subpAsNode.once('spawn', () => {
        const stdinWeb = streams.Writable.toWeb(internalStdinStream);
        if (isArrayBufferView(stdinSrc)) stdinSrc = new Blob([stdinSrc]);
        if (stdinSrc instanceof Blob) void stdinSrc.stream().pipeTo(stdinWeb);
        else if (stdinSrc instanceof Response || stdinSrc instanceof Request) void stdinSrc.body!.pipeTo(stdinWeb);
        else if (typeof stdinSrc === 'number') void fs.createReadStream('', { fd: stdinSrc }).pipe(internalStdinStream);
        else void stdinSrc;
    });
    // change the error stack to point to the spawn() call instead of internal Node.js callback stuff
    const here = new Error('§__PLACEHOLDER__§');
    Error.captureStackTrace(here, spawn);
    if (!subpAsNode.pid) return subpAsNode.once('error', (err: SystemError) => {
        err.message = (err.syscall ?? `spawn ${err.path ?? ''}`) + ' ' + (err.code ?? String(err.errno ?? ''));
        err.stack = here.stack!.replace('§__PLACEHOLDER__§', err.message);
        throw err;
    }) as unknown as Subprocess;
    return subp;
}) satisfies typeof Bun.spawn;
export const spawnSync = ((...args): SyncSubprocess => {
    let cmd: string;
    let argv: string[];
    let opts: SpawnOptions.OptionsObject;
    if (args[0] instanceof Array) {
        cmd = args[0][0];
        argv = args[0].slice(1);
        opts = isOptions(args[1]) ? args[1] : {};
    } else {
        cmd = args[0].cmd[0];
        argv = args[0].cmd.slice(1);
        opts = args[0];
        Reflect.deleteProperty(opts, 'cmd');
    }

    let stdio: StdioOptions = [];
    opts.stdio ??= [undefined, undefined, undefined];
    if (opts.stdin) opts.stdio[0] = opts.stdin;
    if (opts.stdout) opts.stdio[1] = opts.stdout;
    if (opts.stderr) opts.stdio[2] = opts.stderr;
    for (let i = 1; i < 3; i++) { // this intentionally skips stdin
        let std = opts.stdio[i];
        if (isArrayBufferView(std)) stdio[i] = streams.Readable.fromWeb(new Blob([std]).stream());
        else if (std instanceof Blob || isFileBlob(std)) stdio[i] = streams.Readable.fromWeb(std.stream());
        else if (std instanceof ReadableStream) stdio[i] = streams.Readable.fromWeb(std);
        else if (std instanceof Response || std instanceof Request) stdio[i] = streams.Readable.fromWeb(std.body!);
        else stdio[i] = std;
    }
    let input: ArrayBufferView | string | undefined;
    if (opts.stdio[0] && typeof opts.stdio[0] !== 'string') {
        stdio[0] = null; // will be overridden by chp.spawnSync "input" option
        //! Due to the fully async nature of Blobs, Responses and Requests,
        //! we can't synchronously get the data out of them here in userland.
        if (opts.stdio[0] instanceof Blob) throw new NotImplementedError('Bun.spawnSync({ stdin: <Blob> })', spawnSync);
        else if (opts.stdio[0] instanceof Response || opts.stdio[0] instanceof Request) throw new NotImplementedError('Bun.spawnSync({ stdin: <Response|Request> })', spawnSync);
        else if (typeof opts.stdio[0] === 'number') input = fs.readFileSync(opts.stdio[0]);
        else input = opts.stdio[0] as ArrayBufferView;
    }

    const subp = chp.spawnSync(cmd, argv, {
        cwd: opts.cwd ?? process.cwd(),
        env: { ...(opts.env as Record<string, string> ?? process.env) },
        stdio, input
    }) as unknown as SyncSubprocess;
    const subpAsNode = subp as unknown as SpawnSyncReturns<Buffer>;
    if (subpAsNode.error) throw subpAsNode.error;

    subp.exitCode = subpAsNode.status ?? NaN; //! not sure what Bun would return here (child killed by signal)
    subp.success = subp.exitCode === 0;
    return subp;
}) satisfies typeof Bun.spawnSync;

export const escapeHTML = ((input) => {
    const str = String(input);
    let out = '';
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        switch (char) {
            case '"': out += '&quot;'; break;
            case "'": out += '&#x27;'; break;
            case '&': out += '&amp;'; break;
            case '<': out += '&lt;'; break;
            case '>': out += '&gt;'; break;
            default: out += char;
        }
    }
    return out;
}) satisfies typeof Bun.escapeHTML;

export const readableStreamToArrayBuffer = ((stream: ReadableStream<ArrayBufferView | ArrayBufferLike>): ArrayBuffer | Promise<ArrayBuffer> => {
    return (async () => {
        const sink = new ArrayBufferSink();
        const reader = stream.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sink.write(value);
        }
        return sink.end() as ArrayBuffer;
    })();
}) satisfies typeof Bun.readableStreamToArrayBuffer;

export const readableStreamToBytes = ((stream: ReadableStream<ArrayBufferView | ArrayBufferLike>): Uint8Array | Promise<Uint8Array> => {
    return (async () => {
        const sink = new ArrayBufferSink();
        sink.start({ asUint8Array: true });
        const reader = stream.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sink.write(value);
        }
        return sink.end() as Uint8Array;
    })();
}) satisfies typeof Bun.readableStreamToBytes;

export const readableStreamToText = (async (stream: ReadableStream<ArrayBufferView | ArrayBuffer>) => {
    let result = '';
    const reader = stream.pipeThrough(new TextDecoderStream()).getReader(); ReadableStreamDefaultReader
    while (true) {
        const { done, value } = await reader.read();
        //! for some reason "done" isnt being set to true so this is just infinitely looping at the moment... sigh
        if (done || !value || !value?.length) break;
        result += value;
    }
    return result;
}) satisfies typeof Bun.readableStreamToText;
export const readableStreamToBlob = (async (stream: ReadableStream<any>) => {
    const parts = await readableStreamToArray(stream);
    return new Blob(parts as BlobPart[]);
}) satisfies typeof Bun.readableStreamToBlob;
export const readableStreamToArray = (async <T = unknown>(stream: ReadableStream<T>) => {
    const array = new Array<T>();
    const reader = stream.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done || !value || !(<any>value)?.length) break;
        array.push(value as unknown as T);
    }
    return array;
}) satisfies typeof Bun.readableStreamToArray;
export const readableStreamToJSON = (async <T = unknown>(stream: ReadableStream<Uint8Array>) => {
    const text = await readableStreamToText(stream);
    try {
        return JSON.parse(text) as T;
    } catch (err) {
        Error.captureStackTrace(err as Error, readableStreamToJSON);
        throw err;
    }
}) satisfies typeof Bun.readableStreamToJSON;

export const concatArrayBuffers = ((buffers, maxLength = Infinity, asUint8Array = false) => {
    let size = 0;
    for (const chunk of buffers) size += chunk.byteLength;
    size = Math.min(size, maxLength);
    const buffer = new ArrayBuffer(size);
    const view = new Uint8Array(buffer);
    let offset = 0;
    for (const chunk of buffers) {
        if (offset > size) break;
        view.set(new Uint8Array(chunk instanceof ArrayBuffer || chunk instanceof SharedArrayBuffer ? chunk : chunk.buffer), offset);
        offset += chunk.byteLength;
    }
    if (asUint8Array) return view;
    return buffer;
}) satisfies typeof Bun.concatArrayBuffers;

export const ArrayBufferSink = ArrayBufferSinkPolyfill satisfies typeof Bun.ArrayBufferSink;

export const pathToFileURL = pathToFileURLNode satisfies typeof Bun.pathToFileURL;
export const fileURLToPath = fileURLToPathNode satisfies typeof Bun.fileURLToPath;

export const dns = dnsPolyfill satisfies typeof Bun.dns;

export const isMainThread = workers.isMainThread satisfies typeof Bun.isMainThread;

//! It may be possible to implement plugins with Node ESM loaders, but it would take some effort and have some caveats.
//! For now, we'll simply make all calls to Bun.plugin no-op, such that manual implementation of an external ESM loader is possible,
//! but without needing to strip out all Bun.plugin calls from the source code for running on Node.
const dummyPluginBuilder: PluginBuilder = ({
    onLoad(constraints: PluginConstraints, callback: OnLoadCallback): void {
        return; // stubbed
    },
    onResolve(constraints: PluginConstraints, callback: OnResolveCallback): void {
        return; // stubbed
    },
    config: { plugins: [], entrypoints: [] },
}) satisfies PluginBuilder;
const bunPlugin = <T extends BunPlugin>(options: T) => options?.setup?.(dummyPluginBuilder) as ReturnType<T['setup']>;
bunPlugin.clearAll = () => void 0;
export const plugin = bunPlugin satisfies typeof Bun.plugin;
/*void plugin({
    name: 'test',
    target: 'bun',
    setup(builder) {
        if (builder.target !== 'bun') return;
        builder.onResolve({ namespace: 'sample', filter: /.+/ }, args => {
            args.importer;
            if (args.path === 'foo') return { namespace: 'redirect', path: 'bar' };
            else return;
        });
        builder.onLoad({ namespace: 'sample', filter: /.+/ }, args => {
            args.path;
            return { loader: 'object', exports: { foo: 'bar' }, contents: 'void 0;' };
        });
    }
});*/

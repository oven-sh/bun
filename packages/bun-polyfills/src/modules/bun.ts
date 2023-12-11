import type {
    BunPlugin, PluginConstraints, PluginBuilder, OnLoadCallback, OnResolveCallback, HeapSnapshot, Password,
    EditorOptions, SpawnOptions, Subprocess, SyncSubprocess, FileBlob as BunFileBlob, ArrayBufferView, Hash,
    CryptoHashInterface as BunCryptoHashInterface,
} from 'bun';
import { TextDecoderStream } from 'node:stream/web';
import { NotImplementedError, type SystemError } from '../utils/errors.js';
import { isArrayBufferView, isFileBlob, isOptions } from '../utils/misc.js';
import dnsPolyfill from './bun/dns.js';
import { FileSink } from './bun/filesink.js';
import {
    bunHash, bunHashProto, CryptoHasher as CryptoHasherPolyfill,
    MD4 as MD4Polyfill, MD5 as MD5Polyfill,
    SHA1 as SHA1Polyfill, SHA224 as SHA224Polyfill,
    SHA256 as SHA256Polyfill, SHA384 as SHA384Polyfill,
    SHA512 as SHA512Polyfill, SHA512_256 as SHA512_256Polyfill,
} from './bun/hashes.js';
import { ArrayBufferSink as ArrayBufferSinkPolyfill } from './bun/arraybuffersink.js';
import { FileBlob, NodeJSStreamFileBlob } from './bun/fileblob.js';
import { listen as listenPolyfill } from './bun/tcp_listen.js';
import { connect as connectPolyfill } from './bun/tcp_connect.js';
import { serve as servePolyfill } from './bun/serve.js';
import TranspilerImpl from './bun/transpiler.js';
import { mmap as mmapper } from './bun/mmap.js';
import { SyncWorker } from '../utils/sync.mjs';
import fs from 'node:fs';
import os from 'node:os';
import v8 from 'node:v8';
import path from 'node:path';
import util from 'node:util';
import zlib from 'node:zlib';
import streams from 'node:stream';
import workers from 'node:worker_threads';
import chp, { type ChildProcess, type StdioOptions, type SpawnSyncReturns } from 'node:child_process';
import { fileURLToPath as fileURLToPathNode, pathToFileURL as pathToFileURLNode } from 'node:url';
import { expect } from 'expect';
import npm_which from 'which';
import openEditor from 'open-editor';
import bcrypt from 'bcryptjs';
import argon2 from 'argon2';
import node_semver from 'semver';
import * as smol_toml from 'smol-toml';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

export const main = path.resolve(process.cwd(), process.argv[1] ?? 'repl') satisfies typeof Bun.main;

//? These are automatically updated on build by tools/updateversions.ts, do not edit manually.
export const version = '1.0.13' satisfies typeof Bun.version;
export const revision = 'fb2dfb233709584d13fddb6815a98cd6003dfaab' satisfies typeof Bun.revision;

export const gc = (
    globalThis.gc
        ? (() => (globalThis.gc!(), process.memoryUsage().heapUsed))
        : process.env.BUN_POLYFILLS_TEST_RUNNER ? () => 0 : (() => {
            const err = new Error('[bun-polyfills] Garbage collection polyfills are only available when Node.js is ran with the --expose-gc flag.');
            Error.captureStackTrace(err, gc);
            throw err;
        })
) satisfies typeof Bun.gc;

//getter(bun, 'cwd', proc.cwd); //! Can't named export a getter
export const origin = '' satisfies typeof Bun.origin;
export const stdin = new NodeJSStreamFileBlob(process.stdin) satisfies typeof Bun.stdin;
export const stdout = new NodeJSStreamFileBlob(process.stdout) satisfies typeof Bun.stdout;
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
    arrayBufferToString(buf) {
        return new TextDecoder(buf instanceof Uint16Array ? 'utf-16' : 'utf-8').decode(buf);
    },
    segfault() {
        const segfault = new Error();
        segfault.name = 'SegfaultTest';
        segfault.message = '';
        console.error(segfault);
        process.exit(1);
    }
} satisfies typeof Bun['unsafe'];

export const Transpiler = TranspilerImpl satisfies typeof Bun.Transpiler;

export const listen = listenPolyfill satisfies typeof Bun.listen;
export const connect = connectPolyfill satisfies typeof Bun.connect;

export const SHA1 = SHA1Polyfill satisfies typeof Bun.SHA1;
export const MD5 = MD5Polyfill satisfies typeof Bun.MD5;
export const MD4 = MD4Polyfill satisfies typeof Bun.MD4;
export const SHA224 = SHA224Polyfill satisfies typeof Bun.SHA224;
export const SHA512 = SHA512Polyfill satisfies typeof Bun.SHA512;
export const SHA384 = SHA384Polyfill satisfies typeof Bun.SHA384;
export const SHA256 = SHA256Polyfill satisfies typeof Bun.SHA256;
export const SHA512_256 = SHA512_256Polyfill satisfies typeof Bun.SHA512_256;

export const CryptoHasher = CryptoHasherPolyfill satisfies typeof Bun.CryptoHasher;
// This only exists as a type, but is declared as a value in bun-types.
export const CryptoHashInterface = undefined as unknown as typeof BunCryptoHashInterface<any>;

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
    if (ms instanceof Date) ms = ms.valueOf() - Date.now();
    if (typeof ms !== 'number') throw new TypeError('argument to sleep must be a number or Date');
    if (ms < 0) throw new TypeError('argument to sleep must not be negative');
    return new Promise(r => setTimeout(r, ms as number));
}) satisfies typeof Bun.sleep;
export const sleepSync = (ms => {
    if (typeof ms !== 'number') throw new TypeError('argument to sleepSync must be a number');
    if (ms < 0) throw new TypeError('argument to sleepSync must not be negative');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}) satisfies typeof Bun.sleepSync;

//? This is not 1:1 matching, but no one should be relying on the exact output of this function anyway.
//? To quote Node's inspect itself: "The output of util.inspect() may change at any time and should not be depended upon programmatically."
//? Of course in Node's case some didn't listen and relied on the output of util.inspect() anyway, but hopefully this won't happen with this one.
export const inspect = util.inspect satisfies typeof Bun.inspect;

export const resolveSync = ((id: string, parent: string) => {
    const require2 = createRequire(path.join(parent, 'caller'));
    if (id.startsWith('file://')) id = fileURLToPath(id);
    return require2.resolve(id);
}) satisfies typeof Bun.resolveSync;
export const resolve = (async (id: string, parent: string) => {
    return resolveSync(id, parent);
}) satisfies typeof Bun.resolve;

//? Yes, this is faster than new Uint8Array(Buffer.allocUnsafe(size).buffer) by about 2.5x in Node.js
export const allocUnsafe = ((size: number) => new Uint8Array(size)) satisfies typeof Bun.allocUnsafe;

export const mmap = mmapper satisfies typeof Bun.mmap;

export const generateHeapSnapshot = ((): HeapSnapshot => {
    const stream = v8.getHeapSnapshot();
    const chunks = [];
    while (true) {
        const chunk = stream.read();
        if (chunk === null) break;
        chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    const json = JSON.parse(raw) as V8HeapSnapshot;
    return {
        version: 2,
        type: 'Inspector',
        nodes: json.nodes,
        edges: json.edges,
        edgeTypes: json.snapshot.meta.edge_types.flat(),
        edgeNames: json.snapshot.meta.edge_fields.flat(),
        nodeClassNames: json.snapshot.meta.node_types.flat(),
    } satisfies HeapSnapshot;
}) satisfies typeof Bun.generateHeapSnapshot;

//! This is a no-op in Node.js, as there is no way to shrink the V8 heap from JS as far as I know.
export const shrink = (() => void 0) satisfies typeof Bun.shrink;

export const openInEditor = ((file: string, opts?: EditorOptions) => {
    const target = [{ file: path.resolve(process.cwd(), file), line: opts?.line, column: opts?.column }] as const;
    if (opts?.editor) openEditor(target, opts);
    else openEditor(target, { editor: process.env.TERM_PROGRAM ?? process.env.VISUAL ?? process.env.EDITOR ?? 'vscode' });
}) satisfies typeof Bun.openInEditor;

export const serve = servePolyfill satisfies typeof Bun.serve;

export const file = ((path: string | URL | Uint8Array | ArrayBufferLike | number, options?: BlobPropertyBag): BunFileBlob => {
    if (path instanceof URL) path = fileURLToPathNode(path);
    else if (typeof path === 'object') {
        if (path instanceof ArrayBuffer || path instanceof SharedArrayBuffer) path = new Uint8Array(path);
        path = new TextDecoder().decode(path);
    }
    return new FileBlob(path, options);
}) satisfies typeof Bun.file;

export const write = (async (
    dest: BunFileBlob | PathLike,
    input: string | Blob | TypedArray | ArrayBufferLike | BlobPart[] | Response | BunFileBlob,
    options?
): ReturnType<typeof Bun.write> => {
    if (!isFileBlob(dest)) {
        if (typeof dest === 'string' || dest instanceof URL) dest = new FileBlob(fs.openSync(dest, 'w+'));
        else {
            dest = new FileBlob(fs.openSync(Buffer.from(
                dest instanceof ArrayBuffer || dest instanceof SharedArrayBuffer ? dest : dest.buffer
            ), 'w+'));
        }
    }
    if (Reflect.get(dest, '@@writeSlice') && isFileBlob(input)) {
        const slice = Reflect.get(dest, '@@writeSlice') as number;
        input = input.slice(0, slice);
    }
    const writer = dest.writer();
    if (Array.isArray(input)) input = new Blob(input);
    if (input instanceof Blob || input instanceof Response) return writer.write(await input.arrayBuffer());
    // @ts-expect-error account for hono's Response monkeypatch
    if (input.constructor.name === '_Response') return writer.write(await input.arrayBuffer());
    if (input instanceof ArrayBuffer || input instanceof SharedArrayBuffer || ArrayBuffer.isView(input)) return writer.write(input);
    if (typeof input === 'string') return writer.write(input);
    // if all else fails, it seems Bun tries to convert to string and write that.
    else return write(dest, String(input));
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
    if (options?.cwd) opts.path = opts.path ? `${options.cwd}:${opts.path}` : options.cwd;
    return npm_which.sync(cmd, opts) as string | null;
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
    if (opts.ipc) throw new NotImplementedError('Bun.spawn({ ipc })', spawn);
    let stdio: StdioOptions = [];
    opts.stdio ??= [undefined, undefined, undefined];
    if (opts.stdin) opts.stdio[0] = opts.stdin;
    if (opts.stdout) opts.stdio[1] = opts.stdout;
    if (opts.stderr) opts.stdio[2] = opts.stderr;
    const ioNeedsPipeHandler: [ArrayBufferView | null, ArrayBufferView | null] = [null, null];
    for (let i = 1; i < 3; i++) { // this intentionally skips stdin
        let std = opts.stdio[i] as SpawnOptions.Readable;
        if (isFileBlob(std)) stdio[i] = (Reflect.get(std, '@@toStream') as () => fs.WriteStream).call(std);
        else if (isArrayBufferView(std)) {
            stdio[i] = 'pipe';
            ioNeedsPipeHandler[i - 1] = std;
        }
        else stdio[i] = std;
    }
    let stdinSrc: typeof opts.stdio[0] = null;
    if (opts.stdio[0] && typeof opts.stdio[0] !== 'string') {
        stdinSrc = opts.stdio[0];
        stdio[0] = 'pipe';
    } else stdio[0] = opts.stdio[0];
    const subp = chp.spawn(cmd, argv, {
        cwd: opts.cwd ?? process.cwd(),
        // why is this set to (string | number) on env values...
        env: { ...(opts.env as Record<string, string> ?? process.env) },
        stdio
    }) as unknown as Subprocess;
    const subpAsNode = subp as unknown as ChildProcess;
    if (subpAsNode.stdout) {
        const rstream = streams.Readable.toWeb(subpAsNode.stdout) as ReadableStream;
        Reflect.set(rstream, 'destroy', function (this: ReadableStream, err?: Error) {
            void (err ? this.cancel(String(err)) : this.cancel()).catch(() => { /* if it fails its already closed */ });
            return this;
        });
        (<Mutable<Subprocess>>subp).stdout = rstream;
        if (ioNeedsPipeHandler[0]) {
            const dest = new Uint8Array(ioNeedsPipeHandler[0].buffer);
            let offset = 0;
            subpAsNode.stdout.on('data', (chunk: Uint8Array) => {
                dest.set(chunk, offset);
                offset += chunk.byteLength;
            });
        }
    }
    if (subpAsNode.stderr) {
        const rstream = streams.Readable.toWeb(subpAsNode.stderr) as ReadableStream;
        Reflect.set(rstream, 'destroy', function (this: ReadableStream, err?: Error) {
            void (err ? this.cancel(String(err)) : this.cancel()).catch(() => { /* if it fails its already closed */ });
            return this;
        });
        (<Mutable<Subprocess>>subp).stderr = rstream;
        if (ioNeedsPipeHandler[1]) {
            const dest = new Uint8Array(ioNeedsPipeHandler[1].buffer);
            let offset = 0;
            subpAsNode.stderr.on('data', (chunk: Uint8Array) => {
                dest.set(chunk, offset);
                offset += chunk.byteLength;
            });
        }
    }
    let internalStdinStream: streams.Writable;
    if (subpAsNode.stdin) {
        const wstream = subpAsNode.stdin;
        internalStdinStream = wstream;
        (<Mutable<Subprocess>>subp).stdin = new FileSink(wstream);
        Reflect.set(subp.stdin as FileSink, 'destroy', function (this: NodeJS.WritableStream, err?: Error) {
            void this.end(); /* if it fails its already closed */
            return this;
        });

    }
    Object.defineProperty(subp, 'readable', { get(this: Subprocess) { return this.stdout; } });
    Object.defineProperty(subp, 'exited', {
        value: new Promise((resolve, reject) => {
            subpAsNode.once('exit', (code, signal) => {
                opts.onExit?.(subp, code, signal && os.constants.signals[signal]);
                resolve(code);
            });
        })
    });
    const unrefFn = subpAsNode.unref;
    subpAsNode.unref = function unref(): void {
        unrefFn.apply(this);
        // unref() alone is basically useless without { detached: true } in spawn options,
        // so we have to manually force it like this.
        this.disconnect?.();
        this.stderr?.destroy?.();
        this.stdout?.destroy?.();
        this.stdin?.end?.();
        this.stdin?.destroy?.();
    };
    if (stdinSrc) subpAsNode.once('spawn', () => {
        const stdinWeb = streams.Writable.toWeb(internalStdinStream);
        if (isArrayBufferView(stdinSrc)) stdinSrc = new Blob([stdinSrc]);
        if (stdinSrc instanceof Blob) void stdinSrc.stream().pipeTo(stdinWeb);
        else if (stdinSrc instanceof Response || stdinSrc instanceof Request) void stdinSrc.body!.pipeTo(stdinWeb);
        // @ts-expect-error account for Hono's Response monkeypatch
        else if (stdinSrc.constructor.name === '_Response') void stdinSrc.body!.pipeTo(stdinWeb);
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
    if (opts.ipc) throw new NotImplementedError('Bun.spawnSync({ ipc })', spawn);
    let stdio: StdioOptions = [];
    opts.stdio ??= ['pipe', 'pipe', 'pipe'];
    if (opts.stdin) opts.stdio[0] = opts.stdin;
    if (opts.stdout) opts.stdio[1] = opts.stdout;
    if (opts.stderr) opts.stdio[2] = opts.stderr;
    const ioNeedsPipeHandler: [ArrayBufferView | null, ArrayBufferView | null] = [null, null];
    for (let i = 1; i < 3; i++) { // this intentionally skips stdin
        let std = opts.stdio[i] as SpawnOptions.Readable;
        if (isFileBlob(std)) stdio[i] = (Reflect.get(std, '@@toStream') as () => fs.WriteStream).call(std);
        else if (isArrayBufferView(std)) {
            stdio[i] = 'pipe';
            ioNeedsPipeHandler[i - 1] = std;
        }
        else stdio[i] = std;
    }
    let input: ArrayBufferView | string | undefined;
    if (opts.stdio[0] && typeof opts.stdio[0] !== 'string') {
        stdio[0] = null; // will be overriden by chp.spawnSync "input" option
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
        stdio: 'pipe', input
    }) as unknown as SyncSubprocess;
    const subpAsNode = subp as unknown as SpawnSyncReturns<Buffer>;
    if (subpAsNode.error) throw subpAsNode.error;
    if (subpAsNode.stdout && ioNeedsPipeHandler[0]) {
        const dest = new Uint8Array(ioNeedsPipeHandler[0].buffer);
        dest.set(subpAsNode.stdout);
    }
    if (subpAsNode.stderr && ioNeedsPipeHandler[1]) {
        const dest = new Uint8Array(ioNeedsPipeHandler[1].buffer);
        dest.set(subpAsNode.stderr);
    }
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

export const TOML = {
    parse(input) {
        // Bun's TOML parser seems highly non-compliant with the TOML spec and not very well tested,
        // for instance it doesn't seem to support Dates and Times at all, and doesn't really handle big integers,
        // the latter is a property smol-toml shares with Bun's parser, only erroring on values that are too big to fit in a JS number,
        // rather than simply silently losing the precision like Bun currently does, which can lead to behavior differences in this polyfill.
        // However most of this is caused by Bun's parser spec non-compliance, so this is an issue to be solved on Bun's native side.
        return smol_toml.parse(input);
    },
} satisfies typeof Bun.TOML;

export const semver = {
    order(v1, v2) {
        return node_semver.compare(v1.toString(), v2.toString());
    },
    satisfies(version, range) {
        return node_semver.satisfies(version.toString(), range.toString());
    },
} satisfies typeof Bun.semver;

export const readableStreamToFormData = (async (stream, boundary?) => {
    if (boundary) {
        if (typeof boundary !== 'string') boundary = new TextDecoder().decode(boundary);
        // Keeping this comment in case it's a types load order case
        // x@ts-expect-error @types/node Response parameters are missing ReadableStream but its supported.
        return await new Response(stream, { headers: { 'content-type': `multipart/form-data; boundary="-${boundary}"` } }).formData() as FormData;
    }
    const fd = new FormData() as FormData;
    new URLSearchParams(await readableStreamToText(stream)).forEach((v, k) => fd.set(k, v));
    return fd;
}) satisfies typeof Bun.readableStreamToFormData;

export const readableStreamToArrayBuffer = ((stream) => {
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

export const readableStreamToText = (async (stream) => {
    let result = '';
    // @ts-ignore Don't quite understand what's going wrong with these types but TextDecoderStream is supported here
    const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += value;
    }
    return result;
}) satisfies typeof Bun.readableStreamToText;

export const readableStreamToBlob = (async (stream) => {
    const parts = await readableStreamToArray(stream);
    return new Blob(parts as BlobPart[]);
}) satisfies typeof Bun.readableStreamToBlob;

export const readableStreamToArray = (async <T = unknown>(stream: ReadableStream<T>) => {
    const array = new Array<T>();
    const reader = stream.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
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

export const concatArrayBuffers = ((buffers) => {
    let size = 0;
    for (const chunk of buffers) size += chunk.byteLength;
    const buffer = new ArrayBuffer(size);
    const view = new Uint8Array(buffer);
    let offset = 0;
    for (const chunk of buffers) {
        view.set(new Uint8Array(chunk instanceof ArrayBuffer || chunk instanceof SharedArrayBuffer ? chunk : chunk.buffer), offset);
        offset += chunk.byteLength;
    }
    return buffer;
}) satisfies typeof Bun.concatArrayBuffers;

export const ArrayBufferSink = ArrayBufferSinkPolyfill satisfies typeof Bun.ArrayBufferSink;

export const pathToFileURL = pathToFileURLNode satisfies typeof Bun.pathToFileURL;
export const fileURLToPath = fileURLToPathNode satisfies typeof Bun.fileURLToPath;

export const dns = dnsPolyfill satisfies typeof Bun.dns;

const Argon2Types = {
    __proto__: null,
    argon2d: argon2.argon2d,
    argon2i: argon2.argon2i,
    argon2id: argon2.argon2id,
} as const;
const syncAwareArgonHash = (async (password: string, algo: Password.Argon2Algorithm): Promise<Uint8Array> => {
    const { workerData } = await import('node:worker_threads');
    const argon2 = (await import(workerData.resolve.argon2)).default as typeof import('argon2');
    return new TextEncoder().encode(await argon2.hash(password, {
        type: workerData.Argon2Types[algo.algorithm] ?? (() => { throw new TypeError(`Invalid algorithm "${algo.algorithm}"`); })(),
        memoryCost: algo.memoryCost ?? 65536,
        timeCost: algo.timeCost ?? 2,
        parallelism: 1,
        version: 19,
    }));
});
const syncAwareArgonVerify = (async (hash: string, password: string, algorithm: Password.AlgorithmLabel): Promise<Uint8Array> => {
    const { workerData } = await import('node:worker_threads');
    const argon2 = (await import(workerData.resolve.argon2)).default as typeof import('argon2');
    return new Uint8Array([+await argon2.verify(hash, password, {
        type: workerData.Argon2Types[algorithm] ?? (() => { throw new TypeError(`Invalid algorithm "${algorithm}"`); })(),
        parallelism: 1,
        version: 19,
    })]);
});

export const password = {
    hash(password, algorithm = 'argon2id') {
        if (typeof password !== 'string') password = new TextDecoder().decode(password);
        if (!password) throw new Error('password must not be empty');
        const algo: Password.Argon2Algorithm | Password.BCryptAlgorithm = typeof algorithm === 'string' ? { algorithm } : algorithm;
        if (algo.algorithm === 'bcrypt') {
            algo.cost ??= 10;
            if (algo.cost < 4 || algo.cost > 31) throw new TypeError('cost must be between 4 and 31');
            if (password.length > 72) password = new TextDecoder().decode(SHA512.hash(password) as unknown as Uint8Array);
            return bcrypt.hash(password, algo.cost);
        } else {
            const argonType = Argon2Types[algo.algorithm];
            if (argonType === undefined) throw new TypeError(`Invalid algorithm "${algo.algorithm}"`);
            algo.timeCost ??= 2;
            algo.memoryCost ??= 64;
            algo.memoryCost *= 1024;
            if (algo.memoryCost < 1024 || algo.memoryCost > 0xFFFFFFFF)
                throw new TypeError(`memoryCost must be between 1 and 0x3FFFFF (got ${algo.memoryCost})`);
            if (!Number.isSafeInteger(algo.timeCost) || algo.timeCost! < 0) throw new TypeError('timeCost must be a positive safe integer');
            return argon2.hash(password, {
                type: argonType,
                memoryCost: algo.memoryCost,
                timeCost: algo.timeCost,
                parallelism: 1,
                version: 19,
            });
        }
    },
    hashSync(password, algorithm = 'argon2id') {
        if (typeof password !== 'string') password = new TextDecoder().decode(password);
        if (!password) throw new Error('password must not be empty');
        const algo: Password.Argon2Algorithm | Password.BCryptAlgorithm = typeof algorithm === 'string' ? { algorithm } : algorithm;
        if (algo.algorithm === 'bcrypt') {
            algo.cost ??= 10;
            if (algo.cost < 4 || algo.cost > 31) throw new TypeError('cost must be between 4 and 31');
            if (password.length > 72) password = new TextDecoder().decode(SHA512.hash(password) as unknown as Uint8Array);
            return bcrypt.hashSync(password, algo.cost ?? 10);
        } else {
            if (Argon2Types[algo.algorithm] === undefined) throw new TypeError(`Invalid algorithm "${algo.algorithm}"`);
            algo.timeCost ??= 2;
            algo.memoryCost ??= 64;
            algo.memoryCost *= 1024;
            if (algo.memoryCost < 1024 || algo.memoryCost > 0xFFFFFFFF)
                throw new TypeError(`memoryCost must be between 1 and 0x3FFFFF (got ${algo.memoryCost})`);
            if (!Number.isSafeInteger(algo.timeCost) || algo.timeCost < 0) throw new TypeError('timeCost must be a positive safe integer');
            const requireModules = { argon2: pathToFileURL(require.resolve('argon2')).href };
            // TODO: use import.meta.resolve once its unflagged and stable
            //const modules = { argon2: import.meta.resolve?.('argon2') ?? '' };
            const worker = new SyncWorker(requireModules, { Argon2Types });
            const out = worker.sync(syncAwareArgonHash, (data) => new TextDecoder().decode(data))(password, algo);
            worker.terminate();
            return out;
        }
    },
    verify(password, hash, algorithm = 'argon2id') {
        if (typeof password !== 'string') password = new TextDecoder().decode(password);
        if (typeof hash !== 'string') hash = new TextDecoder().decode(hash);
        if (arguments.length < 2) throw new Error('password and hash must not be empty');
        if (!password || !hash) return Promise.resolve(false);
        if (hash[0] !== '$') throw new TypeError('Invalid hash');
        if (algorithm === 'bcrypt') {
            return bcrypt.compare(password, hash);
        } else {
            const argonType = Argon2Types[algorithm];
            if (argonType === undefined) throw new TypeError(`Invalid algorithm "${algorithm}"`);
            return argon2.verify(hash, password, {
                type: argonType,
                parallelism: 1,
                version: 19,
            });
        }
    },
    verifySync(password, hash, algorithm = 'argon2id') {
        if (typeof password !== 'string') password = new TextDecoder().decode(password);
        if (typeof hash !== 'string') hash = new TextDecoder().decode(hash);
        if (arguments.length < 2) throw new Error('password and hash must not be empty');
        if (!password || !hash) return false;
        if (hash[0] !== '$') throw new TypeError('Invalid hash');
        if (algorithm === 'bcrypt') {
            return bcrypt.compareSync(password, hash);
        } else {
            if (Argon2Types[algorithm] === undefined) throw new TypeError(`Invalid algorithm "${algorithm}"`);
            const requireModules = { argon2: pathToFileURL(require.resolve('argon2')).href };
            // TODO: use import.meta.resolve once its unflagged and stable
            //const modules = { argon2: import.meta.resolve?.('argon2') ?? '' };
            const worker = new SyncWorker(requireModules, { Argon2Types });
            const out = worker.sync(syncAwareArgonVerify, (data) => !!data[0])(hash, password, algorithm);
            worker.terminate();
            return out;
        }
    },
} satisfies typeof Bun.password;

export const deepEquals = ((a, b) => {
    try {
        expect(a).toEqual(b);
    } catch {
        return false;
    }
    return true;
}) satisfies typeof Bun.deepEquals;

export const deepMatch = ((a, b) => {
    try {
        expect(b).toMatchObject(a as Record<string, unknown>);
    } catch {
        return false;
    }
    return true;
}) satisfies typeof Bun.deepMatch;

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
    module(specifier: string, callback) {
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

export * as default from './bun.js';

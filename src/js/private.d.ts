// The types in this file are not publicly defined, but do exist.
// Stuff like `Bun.jest()` and so on.

/**
 * If this is not tree-shaken away, the bundle will fail.
 */
declare function $bundleError(...message: any[]): never;

declare module "bun" {
  namespace SQL.__internal {
    type Define<T, K extends keyof T = never> = T extends any
      ? T & {
          [Key in K | "adapter"]: NonNullable<T[Key]>;
        } & {}
      : never;

    type Adapter = NonNullable<Bun.SQL.Options["adapter"]>;
    type ChannelBinding = "disable" | "prefer" | "require";

    type AnyOptions = Omit<Bun.SQL.PostgresOrMySQLOptions, "adapter"> &
      Omit<Bun.SQL.SQLiteOptions, "adapter"> & {
        adapter?: Adapter;
        socket?: unknown;
        channelBinding?: ChannelBinding;
        foundRows?: boolean;
        transform?: any;
      };

    /**
     * Represents the result of the `parseOptions()` function in the sqlite path
     */
    type DefinedSQLiteOptions = Define<Bun.SQL.SQLiteOptions> & {
      filename: string;
      transform?: import("internal/sql/shared").Transform;
    };

    /**
     * Represents the result of the `parseOptions()` function in the postgres, mysql or mariadb path
     */
    type DefinedPostgresOrMySQLOptions = Define<Bun.SQL.PostgresOrMySQLOptions, "max" | "prepare"> & {
      sslMode: import("internal/sql/options").SSLMode;
      channelBinding: ChannelBinding;
      foundRows: boolean;
      query: string;
      transform?: import("internal/sql/shared").Transform;
    };

    type DefinedOptions = DefinedSQLiteOptions | DefinedPostgresOrMySQLOptions;
  }
}

declare module "bun" {
  type int32 = number & { readonly "bun.int32"?: true };
  function jest(path: string): typeof import("bun:test");
  var main: string;
  var FFI: any;
  /** This version of fetch is untamperable */
  var fetch: typeof globalThis.fetch;

  // Builtins create option bags as `{ __proto__: null, ... }`, which TypeScript treats as an ordinary property.
  interface EventListenerOptions {
    __proto__?: null;
  }

  // Listen options `node:net` passes that the public types do not declare. The native `SocketConfig` applies them
  // to the hostname and unix forms. It parses them for the fd form too, where they have no effect: the fd is
  // already bound, and `hostname` is dropped in favour of it.
  interface SocketOptions<Data = unknown> {
    pauseOnConnect?: boolean;
  }
  interface TCPSocketListenOptions<Data = undefined> {
    reusePort?: boolean;
    ipv6Only?: boolean;
  }
  interface UnixSocketOptions<Data = undefined> {
    exclusive?: boolean;
    reusePort?: boolean;
    ipv6Only?: boolean;
  }
  interface FdSocketOptions<Data = undefined> {
    hostname?: string;
    exclusive?: boolean;
    reusePort?: boolean;
    ipv6Only?: boolean;
  }
  function listen<Data = undefined>(options: FdSocketOptions<Data>): SocketListener<Data>;

  // The form of `Bun.serve` that `node:http` uses: requests go to `onNodeHTTPRequest` instead of `fetch` / `routes`.
  namespace Serve {
    interface NodeHTTPServeOptions<WebSocketData> extends HostnamePortServeOptions<WebSocketData> {
      unix?: string;
      onNodeHTTPRequest(
        bunServer: Server<WebSocketData>,
        url: string,
        method: string,
        dispatchBits: number,
        handle: any,
        hasBody: boolean,
        socketHandle: any,
        isSocketNew: boolean,
        socket: any,
        isAncientHTTP: boolean,
        connectHead?: Buffer,
        isPipelinedDispatch?: boolean,
      ): Promise<unknown> | void;
    }
  }
  function serve<WebSocketData>(options: Serve.NodeHTTPServeOptions<WebSocketData>): Server<WebSocketData>;

  // The form of `Bun.spawn` / `Bun.spawnSync` that `node:child_process` uses: `cmd` inside the options, node's
  // stdio entries, and `onDisconnect` told whether the channel closed cleanly.
  namespace Spawn {
    // `globalThis.`: inside this module the bare name is Bun's narrower `ArrayBufferView` alias.
    type NodeStdio = (Bun.SpawnOptions.Writable | globalThis.ArrayBufferView | "ipc" | "socket-fd")[];
    interface NodeSpawnOptions extends Omit<
      Bun.Spawn.SpawnOptions<Bun.SpawnOptions.Writable, Bun.SpawnOptions.Readable, Bun.SpawnOptions.Readable>,
      "stdio" | "onDisconnect"
    > {
      cmd: string[];
      stdio: NodeStdio;
      onDisconnect?(ok: boolean): void;
    }
    interface NodeSpawnSyncOptions extends Omit<
      Bun.Spawn.SpawnSyncOptions<Bun.SpawnOptions.Writable, Bun.SpawnOptions.Readable, Bun.SpawnOptions.Readable>,
      "stdio"
    > {
      cmd: string[];
      stdio: NodeStdio;
    }
  }
  function spawn(options: Spawn.NodeSpawnOptions): Subprocess;
  function spawnSync(options: Spawn.NodeSpawnSyncOptions): SyncSubprocess;

  // `Bun.dns` also has the methods of the native `Resolver` class, which `node:dns` calls when no resolver
  // instance is involved. `setLocalAddress` and `cancel` exist on a `Resolver` only.
  namespace dns {
    type ServerTriple = [family: number, address: string, port: number];
    interface NativeResolver {
      getServers(): string[];
      setServers(servers: ServerTriple[]): void;
      setLocalAddress(first: string, second?: string): void;
      cancel(): void;
      resolve(hostname: string, rrtype: string): Promise<unknown[]>;
      resolveAny(hostname: string): Promise<unknown[]>;
      resolveCname(hostname: string): Promise<string[]>;
      resolveCaa(hostname: string): Promise<unknown[]>;
      resolveMx(hostname: string): Promise<unknown[]>;
      resolveNaptr(hostname: string): Promise<unknown[]>;
      resolveNs(hostname: string): Promise<string[]>;
      resolvePtr(hostname: string): Promise<string[]>;
      resolveSoa(hostname: string): Promise<unknown>;
      resolveSrv(hostname: string): Promise<unknown[]>;
      resolveTxt(hostname: string): Promise<string[][]>;
      reverse(ip: string): Promise<string[]>;
    }
    const getServers: NativeResolver["getServers"];
    const setServers: NativeResolver["setServers"];
    const resolve: NativeResolver["resolve"];
    const resolveAny: NativeResolver["resolveAny"];
    const resolveCname: NativeResolver["resolveCname"];
    const resolveCaa: NativeResolver["resolveCaa"];
    const resolveMx: NativeResolver["resolveMx"];
    const resolveNaptr: NativeResolver["resolveNaptr"];
    const resolveNs: NativeResolver["resolveNs"];
    const resolvePtr: NativeResolver["resolvePtr"];
    const resolveSoa: NativeResolver["resolveSoa"];
    const resolveSrv: NativeResolver["resolveSrv"];
    const resolveTxt: NativeResolver["resolveTxt"];
    const reverse: NativeResolver["reverse"];
    function lookupService(
      address: string,
      port: number,
    ): Promise<[hostname: string | undefined, service: string | undefined]>;
    // The options as `node:dns` passes them on. It has validated `family` (0, 4 or 6) and `flags`.
    function lookup(
      hostname: string,
      options: {
        family?: number | string | null;
        hints?: number;
        flags?: number;
        all?: boolean;
        order?: string;
        verbatim?: boolean;
        backend?: string;
      },
    ): Promise<{ address: string; family: 4 | 6; ttl: number }[]>;
  }
}

declare module "node:stream/web" {
  interface ReadableStreamDefaultReader<R = any> {
    readMany(): Promise<Bun.ReadableStreamDefaultReadManyResult<R>> | Bun.ReadableStreamDefaultReadManyResult<R>;
  }
}

// Builtins write option bags as `{ __proto__: null, ... }`; TypeScript treats `__proto__` there as an ordinary property.
interface ProxyHandler<T extends object> {
  __proto__?: null;
}
interface PropertyDescriptor {
  __proto__?: null;
}

declare namespace NodeJS {
  interface Process {
    /** The `-e` / `--eval` source, which `node:child_process` reads when it forks the current script. */
    _eval?: string;
    /** Set by `node:domain` while a domain is active. */
    domain?: $Node.Domain | null;
    // Bun::Process (src/jsc/bindings/BunProcess.cpp): what builtins use of the `process` that native code hands them.
    on(event: string | symbol, listener: (...args: any[]) => void): this;
    nextTick(callback: Function, ...args: unknown[]): void;
    exit(code?: number | string | null): never;
    /** Set once `exit()` has begun. */
    _exiting?: boolean;
    readonly pid: number;
    argv0: string;
    noDeprecation?: boolean;
    traceDeprecation?: boolean;
    traceProcessWarnings?: boolean;
  }
}

declare namespace NodeJS {
  // What `setTimeout` and `setInterval` answer: src/runtime/timer/Timer.bind.ts (Timeout), src/runtime/timer
  interface Timeout {
    ref(): this;
    unref(): this;
    hasRef(): boolean;
    refresh(): this;
    close(): this;
    [Symbol.toPrimitive](): number;
  }

  /** An `Error` that a failed system call is reported with. */
  interface ErrnoException extends Error {
    errno?: number;
    code?: string;
    path?: string;
    syscall?: string;
  }

  // What `setImmediate` answers: src/runtime/timer/Timer.bind.ts (Immediate)
  interface Immediate {
    ref(): this;
    unref(): this;
    hasRef(): boolean;
  }

  // What `Error.prepareStackTrace` receives: src/jsc/bindings/CallSitePrototype.cpp
  interface CallSite {
    getThis(): unknown;
    getTypeName(): string | null;
    getFunction(): Function | undefined;
    getFunctionName(): string | null;
    getMethodName(): string | null;
    getFileName(): string | null;
    getLineNumber(): number | null;
    getColumnNumber(): number | null;
    getScriptId(): number;
    getEvalOrigin(): string | undefined;
    getScriptNameOrSourceURL(): string | null;
    isToplevel(): boolean;
    isEval(): boolean;
    isNative(): boolean;
    isConstructor(): boolean;
    isAsync(): boolean;
    isPromiseAll(): boolean;
    getPromiseIndex(): number | null;
    toString(): string;
  }
}

declare function $ERR_INVALID_ARG_TYPE(argName: string, expectedTypes: string | string[], actualValue: any): TypeError;
declare function $getProxyInternalField(proxy: object, field: TODO): TODO;
declare function $min(...values: number[]): number;

/** Defined by the fuzzilli build; `src/js/eval/fuzzilli-reprl.ts` calls it and cannot declare it (see its header). */
declare function resetCoverage(): void;

interface LoaderEntry {
  key: string;
  state: number;
  fetch: Promise<JSCSourceCodeObject>;
  instantiate: Promise<any>;
  satisfy: Promise<any>;
  dependencies: string[];
  module: LoaderModule;
  linkError?: any;
  linkSucceeded: boolean;
  evaluated: boolean;
  then?: any;
  isAsync: boolean;
  isSatisfied: boolean;
}

interface LoaderModule {
  dependenciesMap: Map<string, LoaderEntry>;
}

declare interface Error {
  code?: string;
}

// V8's stack trace API: https://v8.dev/docs/stack-trace-api
interface ErrorConstructor {
  captureStackTrace(targetObject: object, constructorOpt?: Function): void;
  prepareStackTrace(error: Error, callSites: unknown[]): unknown;
  stackTraceLimit: number;
}

/** A CommonJS require cache: resolved path -> module. */
type RequireMap = Map<string, JSCommonJSModule>;

interface JSCommonJSModule {
  /** The require cache the module reads and writes: the global one, or its Bun.ModuleGraph's. */
  readonly $requireMap: RequireMap;
  children: JSCommonJSModule[];
  exports: any;
  id: string;
  loaded: boolean;
  parent: undefined;
  path: string;
  paths: string[];
  require: typeof require;
  filename: string;
}

/**
 * Call a native c++ binding, getting whatever it returns.
 *
 * This is more like a macro; it is replaced with a WebKit intrisic during
 * codegen. Passing a template parameter will break codegen. Prefer `$cpp(...)
 * as Foo` instead.
 *
 * Binding files are located in `src/jsc/bindings`
 *
 * @see {@link $bindgen} for native Rust bindings.
 * @see `src/codegen/replacements.ts` for the script that performs replacement of this funciton.
 *
 * @param filename name of the c++ file containing the function. Do not pass a path.
 * @param symbol   The name of the binding function to call. Use `dot.notation` to access
 *                 member symbols.
 *
 * @returns whatever the binding function returns.
 */
declare function $cpp<T = any>(filename: NativeFilenameCPP, symbol: string): T;
declare function $newCppFunction<T = (...args: any) => any>(
  filename: NativeFilenameCPP,
  symbol: string,
  argCount: number,
): T;
/**
 * Retrieves a handle to a function, namespace or class defined in native code, defined in a
 * `.bind.ts` file. For more information on how to define bindgen functions, see
 * [bindgen's documentation](https://bun.com/docs/project/bindgen).
 * `undefined` for a `*_test.bind.ts` file in a build without assertions.
 * @param filename - The basename of the `.bind.ts` file.
 * @param name - The name of the export.
 */
declare function $bindgen<File extends keyof $Bindgen.Exports, Name extends keyof $Bindgen.Exports[File]>(
  filename: File,
  name: Name,
): $Bindgen.Exports[File][Name];
declare function $bindgen<File extends keyof $Bindgen.Namespaces, Name extends keyof $Bindgen.Namespaces[File]>(
  filename: File,
  name: Name,
): $Bindgen.Namespaces[File][Name];
// NOTE: $debug, $assert, and $isPromiseFulfilled omitted

declare module "node:stream" {
  interface ReadableOptions {
    __proto__?: null;
  }
}

declare module "node:net" {
  function _normalizeArgs(options: any[]): [Record<PropertyKey, any>, Function | null];

  namespace SocketAddress {
    function isSocketAddress(value: unknown): value is SocketAddress;
  }

  interface Socket {
    // `data` is `undefined` once an IPC socket has been handed off.
    _handle: Bun.Socket<{ self: Socket; req?: object } | undefined> | null;
    connect(
      options: { fd: number; fdIsRawSocket?: boolean; pauseOnConnect?: boolean },
      connectionListener?: () => void,
    ): this;
    server: Server | null;
  }

  interface Server {
    _handle: Bun.SocketListener<Socket> | null;
    _connections: number;
  }
}

declare module "bun" {
  // src/runtime/api/Glob.bind.ts: the native halves of `scan` and `scanSync`.
  interface Glob {
    $globScan(
      options?:
        | string
        | {
            cwd?: string | null;
            dot?: boolean | null;
            absolute?: boolean | null;
            followSymlinks?: boolean | null;
            throwErrorOnBrokenSymlink?: boolean | null;
            onlyFiles?: boolean | null;
          }
        | null,
    ): Promise<string[] | undefined>;
    $globScanSync(options?: Parameters<Glob["$globScan"]>[0]): string[] | undefined;
    match(path: string): boolean;
    // src/js/builtins/Glob.ts
    scan(options?: Parameters<Glob["$globScan"]>[0]): AsyncIterableIterator<string>;
    scanSync(options?: Parameters<Glob["$globScan"]>[0]): IterableIterator<string>;
  }
}

declare module "bun" {
  // `Bun.connect` in terms of the native socket class, as src/js/internal/debugger.ts calls it.
  function connect<Data>(options: {
    unix?: string;
    fd?: number;
    hostname?: string;
    port?: number;
    socket: {
      open?(socket: $Node.SocketHandle<Data>): void;
      data?(socket: $Node.SocketHandle<Data>, data: Buffer): void;
      drain?(socket: $Node.SocketHandle<Data>): void;
      close?(socket: $Node.SocketHandle<Data>, error?: Error): void;
    };
  }): Promise<$Node.SocketHandle<Data>>;

  // Members of the native server classes that the public type leaves out.
  interface Server<WebSocketData> {
    readonly address: $Node.NativeHTTPServer["address"];
    closeIdleConnections(): number;
  }

  // The native class `ServerWebSocket`: src/runtime/server/server.bind.ts, ServerWebSocket.rs.
  interface ServerWebSocket<T = undefined> {
    data: T;
    readonly readyState: number;
    readonly remoteAddress: string;
    readonly subscriptions: string[];
    readonly isPaused: boolean;
    binaryType?: "nodebuffer" | "arraybuffer" | "uint8array" | "blob";
    send(data: string | ArrayBufferView | ArrayBufferLike | Blob, compress?: boolean): number;
    sendText(data: string, compress?: boolean): number;
    sendBinary(data: ArrayBufferView | ArrayBufferLike | Blob, compress?: boolean): number;
    ping(data?: string | ArrayBufferView | ArrayBufferLike | Blob): number;
    pong(data?: string | ArrayBufferView | ArrayBufferLike | Blob): number;
    publish(topic: string, data: string | ArrayBufferView | ArrayBufferLike | Blob, compress?: boolean): number;
    publishText(topic: string, data: string, compress?: boolean): number;
    publishBinary(topic: string, data: ArrayBufferView | ArrayBufferLike | Blob, compress?: boolean): number;
    subscribe(topic: string): boolean;
    unsubscribe(topic: string): boolean;
    isSubscribed(topic: string): boolean;
    close(code?: number, reason?: string): void;
    terminate(): void;
    cork<R = unknown>(callback: (ws: ServerWebSocket<T>) => R): R;
    getBufferedAmount(): number;
    pause(): void;
    resume(): void;
  }
}

// src/runtime/webcore/TextDecoder.rs. Its value is declared in builtins.d.ts.
interface TextDecoder {
  readonly encoding: string;
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;
  decode(input?: ArrayBufferView | ArrayBuffer | SharedArrayBuffer, options?: { stream?: boolean }): string;
}

// src/jsc/bindings/webcore/JSTextEncoder.cpp
interface TextEncoder {
  readonly encoding: "utf-8";
  encode(input?: string): Uint8Array<ArrayBuffer>;
  encodeInto(source: string, destination: Uint8Array): { read: number; written: number };
}
declare var TextEncoder: {
  new (): TextEncoder;
  prototype: TextEncoder;
};

// Host classes under their public names: the built-ins table binds a native class to the path of its type.

// src/jsc/bindings/webcore/JSEventTarget.cpp
interface EventTarget {
  addEventListener<E>(
    type: string,
    listener: ((event: E) => void) | { handleEvent(event: E): void } | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<E>(
    type: string,
    listener: ((event: E) => void) | { handleEvent(event: E): void } | null,
    options?: boolean | { capture?: boolean },
  ): void;
  dispatchEvent(event: object): boolean;
}
declare var EventTarget: {
  new (): EventTarget;
  prototype: EventTarget;
};

// src/jsc/bindings/webcore/JSAbortSignal.cpp
interface AbortSignal extends EventTarget {
  readonly aborted: boolean;
  readonly reason: unknown;
  onabort: ((event: object) => void) | null;
  throwIfAborted(): void;
}
declare var AbortSignal: {
  prototype: AbortSignal;
  /** Throws. It is declared so that `instanceof AbortSignal` is allowed. */
  new (): AbortSignal;
  abort(reason?: unknown): AbortSignal;
  timeout(milliseconds: number): AbortSignal;
  any(signals: Iterable<AbortSignal>): AbortSignal;
};

// src/jsc/bindings/webcore/JSAbortController.cpp
interface AbortController {
  readonly signal: AbortSignal;
  abort(reason?: unknown): void;
}
declare var AbortController: {
  new (): AbortController;
  prototype: AbortController;
};

// src/jsc/bindings/webcore/streams/JSReadableStreamDefaultController.cpp
interface ReadableStreamDefaultController<R = any> {
  readonly desiredSize: number | null;
  close(): void;
  enqueue(chunk?: R): void;
  error(reason?: unknown): void;
}
declare var ReadableStreamDefaultController: {
  prototype: ReadableStreamDefaultController;
};

// src/jsc/bindings/webcore/streams/JSReadableStreamBYOBRequest.cpp. builtins.d.ts declares the class.
interface ReadableStreamBYOBRequest {
  readonly view: ArrayBufferView | null;
  respond(bytesWritten: number): void;
  respondWithNewView(view: ArrayBufferView): void;
}

// src/jsc/bindings/webcore/streams/JSReadableByteStreamController.cpp. builtins.d.ts declares the class.
interface ReadableByteStreamController {
  readonly byobRequest: ReadableStreamBYOBRequest | null;
  readonly desiredSize: number | null;
  close(): void;
  enqueue(chunk: ArrayBufferView): void;
  error(reason?: unknown): void;
}

// src/jsc/bindings/webcore/streams/JSWritableStream.cpp
interface WritableStream<W = any> {
  readonly locked: boolean;
  abort(reason?: unknown): Promise<void>;
  close(): Promise<void>;
  getWriter(): WritableStreamDefaultWriter<W>;
}
interface UnderlyingSink<W = any> {
  start?(controller: WritableStreamDefaultController): unknown;
  write?(chunk: W, controller: WritableStreamDefaultController): unknown;
  close?(): unknown;
  abort?(reason: unknown): unknown;
  type?: undefined;
}
declare var WritableStream: {
  new <W = any>(
    underlyingSink?: UnderlyingSink<W>,
    strategy?: { highWaterMark?: number; size?(chunk: W): number },
  ): WritableStream<W>;
  prototype: WritableStream;
};

// src/jsc/bindings/webcore/streams/JSWritableStreamDefaultWriter.cpp
interface WritableStreamDefaultWriter<W = any> {
  readonly closed: Promise<void>;
  readonly desiredSize: number | null;
  readonly ready: Promise<void>;
  abort(reason?: unknown): Promise<void>;
  close(): Promise<void>;
  releaseLock(): void;
  write(chunk?: W): Promise<void>;
}
declare var WritableStreamDefaultWriter: {
  new <W = any>(stream: WritableStream<W>): WritableStreamDefaultWriter<W>;
  prototype: WritableStreamDefaultWriter;
};

// src/jsc/bindings/webcore/streams/JSWritableStreamDefaultController.cpp
interface WritableStreamDefaultController {
  readonly signal: AbortSignal;
  error(reason?: unknown): void;
}
declare var WritableStreamDefaultController: {
  prototype: WritableStreamDefaultController;
};

// src/jsc/bindings/webcore/streams/JSTransformStream.cpp
interface TransformStream<I = any, O = any> {
  readonly readable: ReadableStream<O>;
  readonly writable: WritableStream<I>;
}
declare var TransformStream: {
  new <I = any, O = any>(
    transformer?: object,
    writableStrategy?: { highWaterMark?: number; size?(chunk: I): number },
    readableStrategy?: { highWaterMark?: number; size?(chunk: O): number },
  ): TransformStream<I, O>;
  prototype: TransformStream;
};

// src/jsc/bindings/JSStringDecoder.cpp, src/jsc/modules/NodeStringDecoderModule.h
declare module "node:string_decoder" {
  interface StringDecoder {
    readonly encoding: string;
    readonly lastChar: Buffer;
    readonly lastNeed: number;
    readonly lastTotal: number;
    /** A string is answered as it is. */
    write(buffer: string | ArrayBufferView): string;
    end(buffer?: ArrayBufferView): string;
    text(buffer: ArrayBufferView, offset: number): string;
  }
  var StringDecoder: {
    new (encoding?: string | null): StringDecoder;
    (encoding?: string | null): void;
    prototype: StringDecoder;
  };
}

// The Web Streams classes are native (src/jsc/bindings/webcore/streams). The members Bun's own modules call:
interface ReadableStream<R = any> {
  readonly locked: boolean;
  getReader(options: { mode: "byob" }): import("node:stream/web").ReadableStreamBYOBReader;
  getReader(options?: { mode?: undefined }): ReadableStreamDefaultReader<R>;
  cancel(reason?: unknown): Promise<void>;
  [Symbol.asyncIterator](): AsyncIteratorObject<R, undefined, unknown>;
}

// src/jsc/bindings/webcore/streams/JSReadableStreamDefaultReader.cpp
interface ReadableStreamDefaultReader<R = any> {
  readonly closed: Promise<void>;
  read(): Promise<{ done: false; value: R } | { done: true; value: undefined }>;
  /** Every chunk in the queue at once; a promise only while the queue is empty. */
  readMany(): Promise<{ done: boolean; size: number; value: R[] }> | { done: boolean; size: number; value: R[] };
  releaseLock(): void;
  cancel(reason?: unknown): Promise<void>;
}
declare var ReadableStreamDefaultReader: {
  prototype: ReadableStreamDefaultReader;
  new <R = any>(stream: ReadableStream<R>): ReadableStreamDefaultReader<R>;
};

// src/jsc/bindings/webcore/JSMessagePort.cpp
interface MessagePort extends EventTarget {
  postMessage(message: unknown, transfer?: Iterable<object> | { transfer?: Iterable<object> }): void;
  start(): void;
  /** `node:worker_threads` replaces it with a function that takes a listener for "close". */
  close(callback?: () => void): void;
  ref(): void;
  unref(): void;
  hasRef(): boolean;
  // `node:worker_threads` adds these to the prototype. A listener gets the event's `data`, `error` or `detail`.
  on(event: string, listener: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
  off(event: string, listener: (...args: any[]) => void): this;
  emit(event: string, ...args: unknown[]): boolean;
}
declare var MessagePort: {
  prototype: MessagePort;
  new (): MessagePort;
};

// src/jsc/bindings/webcore/JSMessageChannel.cpp
interface MessageChannel {
  readonly port1: MessagePort;
  readonly port2: MessagePort;
}
declare var MessageChannel: {
  prototype: MessageChannel;
  new (): MessageChannel;
};

// src/jsc/bindings/webcore/JSWebSocket.cpp
interface WebSocket extends EventTarget {
  readonly url: string;
  readonly readyState: number;
  readonly bufferedAmount: number;
  readonly protocol: string;
  readonly extensions: string;
  readonly isPaused: boolean;
  binaryType: "nodebuffer" | "arraybuffer" | "blob";
  send(data: string | ArrayBufferLike | ArrayBufferView | Blob): void;
  close(code?: number, reason?: string | ArrayBufferView): void;
  ping(data?: string | ArrayBufferLike | ArrayBufferView | Blob): void;
  pong(data?: string | ArrayBufferLike | ArrayBufferView | Blob): void;
  terminate(): void;
  pause(): void;
  resume(): void;
}
declare var WebSocket: {
  prototype: WebSocket;
  new (url: string | URL, protocols?: string | string[] | object): WebSocket;
  readonly CONNECTING: 0;
  readonly OPEN: 1;
  readonly CLOSING: 2;
  readonly CLOSED: 3;
};

// src/jsc/bindings/webcore/JSFetchHeaders.cpp
interface Headers {
  readonly count: number;
  append(name: string, value: string): void;
  delete(name: string): void;
  get(name: string): string | null;
  getAll(name: "set-cookie" | "Set-Cookie"): string[];
  getSetCookie(): string[];
  has(name: string): boolean;
  set(name: string, value: string): void;
  forEach(callback: (value: string, name: string, parent: Headers) => void, thisArg?: unknown): void;
  entries(): IterableIterator<[string, string]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
  [Symbol.iterator](): IterableIterator<[string, string]>;
  toJSON(): Record<string, string> & { "set-cookie"?: string[] };
}
declare var Headers: {
  prototype: Headers;
  new (init?: Headers | Record<string, string | readonly string[]> | Iterable<readonly string[]>): Headers;
};

// src/runtime/webcore/response.bind.ts, Request.rs, Response.rs, Body.rs
declare namespace $Node {
  /** What `Request` and `Response` share. */
  interface Body {
    readonly body: ReadableStream<Uint8Array<ArrayBuffer>> | null;
    readonly bodyUsed: boolean;
    readonly headers: Headers;
    readonly url: string;
    arrayBuffer(): Promise<ArrayBuffer>;
    blob(): Promise<Blob>;
    bytes(): Promise<Uint8Array<ArrayBuffer>>;
    formData(): Promise<FormData>;
    json(): Promise<any>;
    text(): Promise<string>;
    textStream(): ReadableStream<string>;
  }
  type BodyInit =
    | string
    | ArrayBufferLike
    | ArrayBufferView
    | Blob
    | FormData
    | URLSearchParams
    | ReadableStream
    | AsyncIterable<string | ArrayBufferLike | ArrayBufferView>
    | null;
  type HeadersInit = ConstructorParameters<typeof Headers>[0];
}
interface Request extends $Node.Body {
  readonly cache: string;
  readonly credentials: string;
  readonly destination: string;
  readonly integrity: string;
  readonly method: string;
  readonly mode: string;
  readonly redirect: string;
  readonly referrer: string;
  readonly referrerPolicy: string;
  readonly signal: AbortSignal;
  clone(): Request;
}
declare var Request: {
  prototype: Request;
  new (
    input: string | URL | Request,
    init?: {
      body?: $Node.BodyInit;
      headers?: $Node.HeadersInit;
      method?: string;
      signal?: AbortSignal | null;
      redirect?: string;
      [option: string]: unknown;
    },
  ): Request;
};
interface Response extends $Node.Body {
  readonly ok: boolean;
  readonly redirected: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly type: string;
  clone(): Response;
}
declare var Response: {
  prototype: Response;
  new (
    body?: $Node.BodyInit,
    init?: number | { status?: number; statusText?: string; headers?: $Node.HeadersInit },
  ): Response;
  json(body?: unknown, init?: number | { status?: number; statusText?: string; headers?: $Node.HeadersInit }): Response;
  redirect(url: string, status?: number | { status?: number; headers?: $Node.HeadersInit }): Response;
  error(): Response;
};

declare namespace $Node {
  /** What a `node:worker_threads` worker finds in its `workerData`. The structured clone makes the object. */
  interface WorkerStdioPorts {
    /** Only for `{ stdin: true }`. */
    stdin?: MessagePort;
    stdout: MessagePort;
    stderr: MessagePort;
  }

  // src/runtime/webcore/Sink.bind.ts, src/runtime/webcore/FileSink.rs
  interface FileSink {
    /** The number of bytes written, or a promise for it while the write is pending. */
    write(chunk: string | AnyView | ArrayBuffer | SharedArrayBuffer): number | Promise<number>;
    flush(wait?: boolean): number | Promise<number>;
    end(error?: Error): number | Promise<number>;
    start(options?: { highWaterMark?: number }): void;
    ref(): void;
    unref(): void;
  }

  // src/jsc/bindings/JSBundlerPlugin.cpp. The functions of src/js/builtins/BundlerPlugin.ts run with it as `this`.
  interface BundlerPlugin {
    onLoad: Map<string, [RegExp, BundlerPlugin.OnLoadCallback][]> | undefined;
    onResolve: Map<string, [RegExp, BundlerPlugin.OnResolveCallback][]> | undefined;
    promises: Promise<unknown>[] | undefined;
    $onEndCallbacks: BundlerPlugin.OnEndCallback[] | undefined;
    /** `internalID`: the address of the native request, as a double. */
    onLoadAsync(
      internalID: number,
      sourceCode: string | ArrayBufferView | ArrayBuffer | null,
      loaderKey: number | null,
    ): void;
    onResolveAsync(
      internalID: number,
      path: string | null,
      namespace: string | null,
      external: boolean | null | undefined,
    ): void;
    addError(internalID: number, error: unknown): void;
    /** `kind`: 0 for onResolve, 1 for onLoad. */
    addFilter(filter: RegExp, namespace: string, kind: number): void;
    onBeforeParse(filter: RegExp, namespace: string, addon: unknown, symbol: string, external?: unknown): void;
    generateDeferPromise(internalID: number): Promise<void>;
  }
  namespace BundlerPlugin {
    interface OnLoadArgs {
      path: string;
      namespace: string;
      loader: string;
      defer: () => Promise<void>;
      side: "server" | "client";
    }
    interface OnLoadResult {
      contents?: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer;
      loader?: string;
      /** With `loader: "object"`. */
      exports?: Record<string, unknown>;
    }
    type OnLoadCallback = (
      args: OnLoadArgs,
    ) => OnLoadResult | undefined | null | void | Promise<OnLoadResult | undefined | null | void>;
    interface OnResolveArgs {
      path: string;
      importer: string;
      namespace: string;
      resolveDir: string | undefined;
      kind: string;
    }
    interface OnResolveResult {
      path?: string;
      namespace?: string;
      external?: boolean | null;
    }
    type OnResolveCallback = (
      args: OnResolveArgs,
    ) => OnResolveResult | undefined | null | void | Promise<OnResolveResult | undefined | null | void>;
    /** `build`: the `Bun.BuildOutput` that native code made. */
    type OnEndCallback = (build: object) => void | Promise<void>;

    // What native code hands on from the caller of `Bun.build` and `Bun.serve`, as it got it.

    /** The options of `Bun.build`, as far as the plugin functions read them. */
    interface Config {
      entrypoints?: string[];
      /** esbuild's capitalization. */
      entryPoints?: string[];
      plugins?: Plugin[];
      minify?: boolean | { identifiers?: boolean; whitespace?: boolean; syntax?: boolean };
      root?: string;
      target?: string;
      experimentalCss?: boolean;
      experimentalHtml?: boolean;
    }
    /** `build`: the object that `runSetupFunction` makes. */
    type Setup = (build: object) => void | Promise<void>;
    interface Plugin {
      name: string;
      target?: string;
      setup: Setup;
    }
  }

  // src/runtime/ipc.rs, ipc_host.rs: what `process.send(message, handle, options)` hands to src/js/builtins/Ipc.ts.

  /** The "NODE_HANDLE" message that `serialize` made in the sending process, decoded. */
  interface SerializedIPCHandle {
    cmd: "NODE_HANDLE";
    msg: unknown;
    type: "net.Server" | "net.Socket" | "dgram.Socket" | "dgram.Native";
    dgramType?: "udp4" | "udp6";
  }

  // src/jsc/bindings/sqlite/JSSQLStatement.cpp. `bun:sqlite` wraps them.

  /** JSSQLDatabase: what `SQLStatementConstructor.open` answers. It has no members. */
  interface SQLDatabase {}
  /** Where `run` leaves `changes` and `lastInsertRowid`. */
  type SQLChangesTuple = InternalFieldObject<[changes: number, lastInsertRowid: number | bigint]>;
  /** The arguments of the public method, as an array: SQLiteBinder::bind decides what they are. */
  type SQLBindings = unknown[];
  type SQLValue = string | bigint | number | Uint8Array | null;

  /** `Row`: what the caller says a row object is. */
  interface SQLStatement<Row = unknown> {
    run(changes: SQLChangesTuple, bindings?: SQLBindings): void;
    get(bindings?: SQLBindings): Row | null;
    all(bindings?: SQLBindings): Row[];
    /** The first row. */
    iterate(bindings?: SQLBindings): Row | null;
    /** The next row of the run `runCount`, or `null` after the last one. */
    iterateNext(runCount: number): Row | null;
    iterateEnd(runCount: number): void;
    readonly runCount: number;
    /** Rows get the prototype of `Class`. */
    as(Class: (new (...args: any[]) => unknown) | undefined): void;
    values(bindings?: SQLBindings): SQLValue[][];
    raw(bindings?: SQLBindings): (Uint8Array | null)[][];
    finalize(): void;
    toString(): string;
    readonly isFinalized: boolean;
    readonly readonly: boolean;
    readonly columns: string[];
    readonly columnsCount: number;
    readonly paramsCount: number;
    readonly columnTypes: ("INTEGER" | "FLOAT" | "TEXT" | "BLOB" | "NULL" | null)[];
    readonly declaredTypes: (string | null)[];
    safeIntegers: boolean;
    /** For the SQLite adapter of `Bun.sql`: makes the key of a row object from the name of a column. */
    $setColumnNameTransform(transform: ((name: string) => string) | null | undefined): void;
    /** Runs the statements of `sql` after this one. The rows they changed; `undefined` when there are none. */
    $runTail(sql: string): number | undefined;
  }

  interface SQLStatementConstructor {
    open(filename: string, flags: number): SQLDatabase;
    handleNumber(handle: SQLDatabase): number;
    isInTransaction(handle: SQLDatabase): boolean;
    loadExtension(handle: SQLDatabase, name: string, entryPoint?: string): void;
    serialize(handle: SQLDatabase, name: string): Buffer;
    deserialize(serialized: ArrayBufferView | ArrayBufferLike, deserializeFlags: number): SQLDatabase;
    fcntl(handle: SQLDatabase, zDbName: string | null, op: number, arg: unknown): number;
    close(handle: SQLDatabase, throwOnError: boolean): void;
    setCustomSQLite(path: string): boolean;
    run(
      handle: SQLDatabase,
      internalFlags: number,
      changes: SQLChangesTuple,
      query: string,
      bindings: SQLBindings,
    ): void;
    /** With `step`: an aggregate, and `functionOrStart` is its `start`. */
    defineFunction(
      handle: SQLDatabase,
      name: string,
      argumentCount: number,
      flags: number,
      safeIntegers: boolean,
      functionOrStart: unknown,
      step?: (...args: any[]) => unknown,
      inverse?: (...args: any[]) => unknown,
      result?: (...args: any[]) => unknown,
    ): void;
    /** `operation`: SQLITE_DELETE, SQLITE_INSERT or SQLITE_UPDATE. */
    updateHook(handle: SQLDatabase, operation: number): ((...args: any[]) => void) | null;
    setUpdateHook(
      handle: SQLDatabase,
      operation: number,
      hook: ((...args: any[]) => void) | null | undefined,
      database: object,
      internalFlags: number,
    ): void;
    prepare<Row>(
      handle: SQLDatabase,
      query: string,
      bindings: SQLBindings | undefined,
      flags: number,
      internalFlags: number,
    ): SQLStatement<Row>;
  }

  // src/runtime/ffi/FFIObject.rs, ffi_body.rs: `Bun.FFI`, which `bun:ffi` wraps. A failure is answered as an Error.

  /** A compiled symbol. It takes and answers what its declaration says. */
  interface FFIFunction {
    (...args: any[]): any;
    ptr?: number;
    native?: FFIFunction;
    close?(): void;
  }
  /** The native class `FFI` (src/runtime/ffi/ffi.bind.ts). */
  interface FFILibrary {
    symbols: Record<string, FFIFunction>;
    close(): void;
  }
  interface FFIObject {
    ptr(view: ArrayBufferView | ArrayBufferLike, byteOffset?: number): number;
    toBuffer(ptr: number, byteOffset?: number, byteLength?: number): Buffer;
    toArrayBuffer(ptr: number, byteOffset?: number, byteLength?: number): ArrayBuffer;
    viewSource(symbols: object, isCallback?: boolean): string | string[] | Error;
    linkSymbols(symbols: object): FFILibrary | Error;
    dlopen(path: string | undefined, symbols: object): FFILibrary | Error;
    CString: new (ptr: number, byteOffset?: number, byteLength?: number) => String;
    read: Record<string, (ptr: number, byteOffset?: number) => number | bigint>;
    // `bun:ffi` takes these three off the object.
    callback?(options: object, callback: (...args: any[]) => unknown): object | Error;
    closeCallback?(callback: object): void;
    cfunction?(options: object, name: string): FFIFunction | Error;
  }

  // More of what `Bun.serve()` returns (src/runtime/server/server.bind.ts).
  interface NativeHTTPServer {
    readonly url: URL;
    /** `true`: the request is a WebSocket now, and `fetch` answers nothing. */
    upgrade(request: Request, options?: { data?: unknown; headers?: HeadersInit }): boolean;
  }

  // src/jsc/bindings/webcore/JSWasmStreamingCompiler.cpp
  interface WasmStreamingCompiler {
    addBytes(bytes: ArrayBufferView | ArrayBuffer): void;
    finalize(): void;
    fail(reason: unknown): void;
    cancel(): void;
  }
}

// Classes from `*.classes.ts`.
declare namespace $Bindgen {
  // src/runtime/webcore/ReadableStream.bind.ts, ReadableStream.rs
  interface FileInternalReadableStreamSource {
    updateRef(ref: boolean): void;
    setFlowing(flowing: boolean): void;
    /** `undefined`, or the system error. */
    setRawMode(enabled: boolean): Error | undefined;
  }

  // src/runtime/api/bun/subprocess.rs. What `Bun.spawn` answers; native code hands it to builtins as an opaque owner.
  interface Subprocess {}

  // src/sql_jsc: the schemas beside mysql/JSMySQLConnection.rs, JSMySQLQuery.rs, postgres/PostgresSQLConnection.rs, PostgresSQLQuery.rs
  interface MySQLConnection {
    close(): void;
    flush(): void;
    /** Until `unhold()`, `maxLifetime` does not close it. */
    hold(): void;
    unhold(): void;
    /** The server's word after its last complete reply. */
    readonly inTransaction: boolean;
    /** PostgreSQL only: the server asked for SASL in the login that is under way or was refused. */
    readonly sasl?: boolean;
  }
  interface PostgresSQLConnection extends MySQLConnection {
    ref(): void;
    readonly sasl: boolean;
    onnotification: ((channel: string, payload: string) => void) | undefined;
  }
  interface MySQLQuery {
    /** `query`: what the driver resolves and rejects, an `internal/sql/query` Query or an object with its members. */
    run(connection: MySQLConnection, query: object): void;
    cancel(): void;
    /** 0: objects, 1: values, 2: raw. */
    setMode(mode: number): void;
    setPendingValue(result: object): void;
    describeResult(result: object): object | null;
  }
  interface PostgresSQLQuery extends MySQLQuery {
    run(connection: PostgresSQLConnection, query: object): void;
    /** `callback()` when the server enters copy mode; then `callback(chunk)` for each chunk (TO STDOUT, `false` pauses the socket) or `callback()` each time the socket has drained (FROM STDIN). */
    setCopy(callback: ((chunk?: Uint8Array) => unknown) | undefined, writable: boolean): void;
    /** `false`: the socket has no room, wait for the callback. */
    copyWrite(chunk: string | ArrayBufferView | ArrayBufferLike): boolean;
    copyDone(): void;
    copyFail(message: string): void;
    copyResume(): void;
  }

  // src/runtime/shell/ParsedShellScript.bind.ts, ParsedShellScript.rs
  interface ParsedShellScript {
    setCwd(cwd: string): void;
    setEnv(env: Record<string, string | undefined>): void;
    setQuiet(quiet: boolean): void;
  }

  // src/runtime/shell/interpreter.bind.ts, interpreter.rs
  interface ShellInterpreter {
    run(): void;
  }
}

declare namespace NodeJS {
  /** What `setTimeout` and `setInterval` answer: the native `Timeout` (src/runtime/timer/Timer.bind.ts). */
  interface Timeout {
    ref(): this;
    unref(): this;
    hasRef(): boolean;
    refresh(): this;
    [Symbol.toPrimitive](): number;
    _idleTimeout: number;
  }
}

// Native objects that `node:net` and `node:tls` hold as `_handle`.
declare namespace $Node {
  /** The same under an older name: write `NodeJS.Timeout`. */
  interface Timeout extends NodeJS.Timeout {}

  /** What `getsockname` fills in, and what `net.Socket` caches as `_sockname` and `_peername`. */
  interface SocketName {
    address?: string;
    family?: string;
    port?: number;
  }

  interface TLSUpgradeOptions<Data> {
    data: Data;
    tls: unknown;
    /** The table of handlers (`open`, `data`, `close` ..). */
    socket: object;
    isServer?: boolean;
    /** What was read off the fd before the upgrade. */
    initialData?: string | Uint8Array;
  }

  /** Node's legacy certificate object, as the native socket builds it. The members that `node:tls` reads. */
  interface PeerCertificate {
    subject?: { CN?: string | string[] };
    subjectaltname?: string;
    raw?: Uint8Array;
    /** With the whole chain only. The root's is the root itself. */
    issuerCertificate?: PeerCertificate;
  }

  /** The native `TCPSocket` and `TLSSocket`: src/runtime/socket/socket_body.bind.ts, socket_body.rs. */
  interface SocketHandle<Data = unknown> {
    data: Data;
    /** -2: shut down, -1: detached, 0: closed, 1: established, 2: connecting. */
    readonly readyState: number;
    readonly bytesWritten: number;
    readonly fd: number;
    readonly listener: ListenerHandle | undefined;
    readonly authorized: boolean;
    readonly alpnProtocol: string | false | null;
    readonly localFamily: "IPv4" | "IPv6" | undefined;
    readonly localAddress: string | undefined;
    readonly localPort: number | undefined;
    readonly remoteFamily: "IPv4" | "IPv6" | undefined;
    readonly remoteAddress: string | undefined;
    readonly remotePort: number | undefined;

    /** `true`: all of it was taken. `false`: the rest waits for `drain`. A negative number: -errno. */
    $write(data: string | ArrayBufferView | ArrayBuffer, encoding?: string): boolean | number;
    $end(data?: string | ArrayBufferView | ArrayBuffer, encoding?: string): boolean;
    write(data: string | ArrayBufferView | ArrayBuffer, byteOffset?: number, byteLength?: number): number;
    end(data?: string | ArrayBufferView | ArrayBuffer, byteOffset?: number, byteLength?: number): number;
    flush(): void;
    shutdown(halfClose?: boolean): void;
    /** The native method takes nothing. `node:net` passes the callback that a libuv handle would call. */
    close(callback?: () => void): void;
    terminate(): undefined;
    ref(): void;
    unref(): void;
    pause(): void;
    resume(): void;
    timeout(seconds: number): void;
    // `new net.Socket({ handle })` keeps any object as its handle, so `node:net` asks for these four before it calls them.
    setNoDelay?(enabled?: boolean): boolean;
    setKeepAlive?(enabled?: boolean, initialDelayMilliseconds?: number): boolean;
    /** 0 or -errno. */
    setTypeOfService?(tos: number): number;
    /** The value or -errno. */
    getTypeOfService?(): number;
    reload(options: { socket: object }): void;
    upgradeTLS<T>(options: TLSUpgradeOptions<T>): [raw: SocketHandle<T>, tls: SocketHandle<T>];

    // On a `TCPSocket` the rest answers `undefined`, `null` or `false`.
    resumeSNI(context: unknown, isError: boolean): void;
    getServername(): string | undefined;
    setServername(name: string): void;
    getSession(): Buffer | undefined;
    setSession(session: string | ArrayBufferView | ArrayBuffer): void;
    getTLSTicket(): Buffer | undefined;
    getTLSVersion(): string | null | undefined;
    getTLSFinishedMessage(): Buffer | undefined;
    getTLSPeerFinishedMessage(): Buffer | undefined;
    getCipher(): { name: string; standardName: string; version: string } | undefined;
    getEphemeralKeyInfo(): { type?: string; name?: string; size?: number } | null;
    getSharedSigalgs(): string[] | null | undefined;
    getAuthorizationError(): Error | null;
    /** `abbreviated`: the leaf alone, without `issuerCertificate` links. */
    getPeerCertificate(abbreviated?: boolean): PeerCertificate | null | undefined;
    getCertificate(): PeerCertificate | null | undefined;
    /** `TLSSocket` only. */
    getPeerX509Certificate?(): object | undefined;
    /** `TLSSocket` only. */
    getX509Certificate?(): object | undefined;
    isSessionReused(): boolean;
    renegotiate(): void;
    disableRenegotiation(): void;
    setVerifyMode(requestCert: boolean, rejectUnauthorized: boolean): void;
    setKeyCert(context: unknown): void;
    setMaxSendFragment(size: number): boolean;
    exportKeyingMaterial(length: number, label: string, context?: string | ArrayBufferView): Buffer | undefined;

    /** On a libuv-style object that was given as `handle`. The native socket has none. */
    getsockname?(out: SocketName): number | undefined;

    // What `node:net` and `node:tls` store on the handle.
    onread?: () => void;
    connecting?: boolean;
    _parentWrap?: unknown;
  }

  /** The native `Listener`: src/runtime/socket/Listener.bind.ts, Listener.rs. */
  interface ListenerHandle {
    data: NetServer;
    readonly fd: number;
    readonly port: number | undefined;
    readonly hostname: string | undefined;
    readonly unix: string | undefined;
    stop(closeActiveConnections?: boolean): void;
    ref(): void;
    unref(): void;
    reload(options: { socket: object }): void;
    getsockname(out: SocketName): undefined;
    /** `node:net` stores it on the handle, where `node:cluster` and tests wrap it. */
    onconnection?: (err: number, clientHandle: SocketHandle<Socket>) => void;
  }

  /** The native `H2FrameParser` of `node:http2`: src/runtime/api/bun/h2_frame_parser.bind.ts, h2_frame_parser.rs. */
  interface H2FrameParser {
    /** The stream's id, or -1. `undefined` where the session has gone. */
    request(
      streamId: number,
      context: unknown,
      headers: object,
      sensitiveNames: object,
      options?: object,
    ): number | undefined;
    setNativeSocket(socket: unknown): void;
    /** `false`: too many pings wait for their acknowledgement. */
    ping(payload: ArrayBufferView): boolean;
    altsvc(origin: string, alt: string, streamId: number): void;
    origin(origins: string | string[]): void;
    goaway(code: number, lastStreamId?: number, opaqueData?: ArrayBufferView): void;
    getCurrentState(): {
      effectiveLocalWindowSize: number;
      effectiveRecvDataLength: number;
      nextStreamID: number;
      lastProcStreamID: number;
      remoteWindowSize: number;
      localWindowSize: number;
      deflateDynamicTableSize: number;
      inflateDynamicTableSize: number;
      outboundQueueSize: number;
    };
    getFrameCounters(): { framesReceived: number; framesSent: number };
    settings(settings: object): boolean;
    setLocalWindowSize(windowSize: number): void;
    read(data: ArrayBufferView): void;
    /** How many bytes still wait. */
    flush(): number;
    detach(): void;
    rstStream(streamId: number, code: number): true | undefined;
    /** `false`: there is no such stream. Otherwise what became of the write. */
    writeStream(
      streamId: number,
      data: string | ArrayBufferView,
      encoding: string | undefined,
      close: boolean,
      callback: (error?: Error | null) => void,
      deferCallback?: boolean,
    ): number | false;
    sendTrailers(streamId: number, headers: object, sensitiveNames: object): void;
    noTrailers(streamId: number): void;
    setStreamReading(streamId: number, reading: boolean): void;
    getStreamContext(streamId: number): unknown;
    setStreamContext(streamId: number, context: unknown): void;
    getEndAfterHeaders(streamId: number): boolean;
    getStreamState(streamId: number): {
      localWindowSize: number;
      state: number;
      localClose: number;
      remoteClose: number;
      sumDependencyWeight: number;
      weight: number;
    };
    bufferSize(): number;
    setNextStreamID(id: number): void;
    /** Calls `callback` with the context of every stream that has one. */
    forEachStream(callback: (stream: never) => void, thisValue?: unknown): void;
    emitErrorToAllStreams(code: number): void;
    emitAbortToAllStreams(): void;
    /** -1 when the ids have run out. */
    getNextStream(): number;
    /** The promised id, or -1. */
    pushPromise(streamId: number, promisedId: number, headers: object, sensitiveNames: object): number;
  }
  interface H2FrameParserConstructor {
    new (options: {
      context: unknown;
      handlers: object;
      settings?: object;
      native?: unknown;
      type?: number;
      [option: string]: unknown;
    }): H2FrameParser;
    prototype: H2FrameParser;
  }

  /** The native `UDPSocket`, what `Bun.udpSocket()` answers: src/runtime/socket/udp_socket.bind.ts, udp_socket.rs. */
  interface UDPSocketHandle {
    readonly hostname: string;
    readonly port: number;
    readonly address: { address: string; family: string; port: number };
    /** `undefined` while it is not connected. */
    readonly remoteAddress?: { address: string; family: string; port: number };
    readonly closed: boolean;
    /** `false`: the kernel's buffer is full, `drain` follows. Without `port` on a connected socket. */
    send(data: string | ArrayBufferView | ArrayBufferLike, port?: number, address?: string): boolean;
    close(): void;
    ref(): void;
    unref(): void;
    setBroadcast(enabled: boolean): boolean;
    setTTL(ttl: number): number;
    setMulticastTTL(ttl: number): number;
    setMulticastLoopback(enabled: boolean): boolean;
    setMulticastInterface(interfaceAddress: string): boolean;
    addMembership(multicastAddress: string, interfaceAddress?: string): boolean;
    dropMembership(multicastAddress: string, interfaceAddress?: string): boolean;
    addSourceSpecificMembership(sourceAddress: string, groupAddress: string, interfaceAddress?: string): boolean;
    dropSourceSpecificMembership(sourceAddress: string, groupAddress: string, interfaceAddress?: string): boolean;
  }

  /** The native `SecureContext`, an SSL_CTX: src/runtime/api/bun/SecureContext.bind.ts, SecureContext.rs. */
  interface NativeSecureContext {
    addCACert(pem: string | ArrayBufferView): void;
  }
  interface NativeSecureContextConstructor {
    new (options?: object): NativeSecureContext;
    prototype: NativeSecureContext;
    /** One context for all equal options. */
    intern(options: object): NativeSecureContext;
    createPrivate(options: object): NativeSecureContext;
    /** PEM texts. `ca`: the bundled CA certificates, one after the other. */
    parsePkcs12(pfx: unknown, passphrase: unknown): { key: string; cert: string; ca?: string };
  }

  /** The native `SocketAddress`: src/runtime/socket/SocketAddress.rs. */
  interface SocketAddress {
    readonly address: string;
    readonly port: number;
    readonly family: "ipv4" | "ipv6";
    readonly flowlabel: number;
    toJSON(): { address: string; port: number; family: "ipv4" | "ipv6"; flowlabel: number };
  }
  interface SocketAddressConstructor {
    new (options?: { address?: string; port?: number; family?: string; flowlabel?: number }): SocketAddress;
    prototype: SocketAddress;
    parse(input: string): SocketAddress | undefined;
    isSocketAddress(value: unknown): value is SocketAddress;
  }

  /** The native `BlockList`: src/runtime/node/net/BlockList.rs. `family` is "ipv4" where it is left out. */
  interface BlockList {
    addAddress(address: string | SocketAddress, family?: string): void;
    addRange(start: string | SocketAddress, end: string | SocketAddress, family?: string): void;
    addSubnet(network: string | SocketAddress, prefix: number, family?: string): void;
    check(address: string | SocketAddress, family?: string): boolean;
    readonly rules: string[];
  }
  interface BlockListConstructor {
    new (): BlockList;
    prototype: BlockList;
    isBlockList(value: unknown): value is BlockList;
  }

  /** What `node:net` passes to `Bun.listen`. */
  interface ListenOptions {
    unix?: string;
    fd?: number;
    port?: number | null;
    hostname?: string;
    tls: unknown;
    allowHalfOpen: boolean;
    reusePort: boolean;
    ipv6Only: boolean;
    exclusive: boolean;
    pauseOnConnect: boolean;
    socket: object;
    data: NetServer;
  }
}

declare module "bun" {
  function listen(options: $Node.ListenOptions): $Node.ListenerHandle;
}

/** What `require` of one of the modules in this directory answers: its default export, or the object of its named exports. */
type $ModuleValue<M> = M extends { default: infer D } ? D : M;
/** Every module in this directory that `require` finds, by specifier. A module that is missing here is `any`. */
interface $BunModules {
  // A native module: src/jsc/modules/NodeStringDecoderModule.h
  "node:string_decoder": typeof import("node:string_decoder");
  "@vercel/fetch": $ModuleValue<typeof import("./thirdparty/vercel_fetch")>;
  "bun:bake": $ModuleValue<typeof import("./bun/bake")>;
  "bun:ffi": $ModuleValue<typeof import("./bun/ffi")>;
  "bun:sql": $ModuleValue<typeof import("./bun/sql")>;
  "bun:sqlite": $ModuleValue<typeof import("./bun/sqlite")>;
  "internal/abort_listener": $ModuleValue<typeof import("./internal/abort_listener")>;
  "internal/assert/assertion_error": $ModuleValue<typeof import("./internal/assert/assertion_error")>;
  "internal/assert/calltracker": $ModuleValue<typeof import("./internal/assert/calltracker")>;
  "internal/assert/myers_diff": $ModuleValue<typeof import("./internal/assert/myers_diff")>;
  "internal/assert/utils": $ModuleValue<typeof import("./internal/assert/utils")>;
  "internal/async_context_frame": $ModuleValue<typeof import("./internal/async_context_frame")>;
  "internal/async_hooks": $ModuleValue<typeof import("./internal/async_hooks")>;
  "internal/async_hooks_tick": $ModuleValue<typeof import("./internal/async_hooks_tick")>;
  "internal/bake": $ModuleValue<typeof import("./internal/bake")>;
  "internal/cluster/RoundRobinHandle": $ModuleValue<typeof import("./internal/cluster/RoundRobinHandle")>;
  "internal/cluster/SharedHandle": $ModuleValue<typeof import("./internal/cluster/SharedHandle")>;
  "internal/cluster/Worker": $ModuleValue<typeof import("./internal/cluster/Worker")>;
  "internal/cluster/child": $ModuleValue<typeof import("./internal/cluster/child")>;
  "internal/cluster/isPrimary": $ModuleValue<typeof import("./internal/cluster/isPrimary")>;
  "internal/cluster/primary": $ModuleValue<typeof import("./internal/cluster/primary")>;
  "internal/debugger": $ModuleValue<typeof import("./internal/debugger")>;
  "internal/dgram": $ModuleValue<typeof import("./internal/dgram")>;
  "internal/errors": $ModuleValue<typeof import("./internal/errors")>;
  "internal/fifo": $ModuleValue<typeof import("./internal/fifo")>;
  "internal/fixed_queue": $ModuleValue<typeof import("./internal/fixed_queue")>;
  "internal/freelist": $ModuleValue<typeof import("./internal/freelist")>;
  "internal/fs/binding": $ModuleValue<typeof import("./internal/fs/binding")>;
  "internal/fs/cp": $ModuleValue<typeof import("./internal/fs/cp")>;
  "internal/fs/cp-sync": $ModuleValue<typeof import("./internal/fs/cp-sync")>;
  "internal/fs/file_handles": $ModuleValue<typeof import("./internal/fs/file_handles")>;
  "internal/fs/glob": $ModuleValue<typeof import("./internal/fs/glob")>;
  "internal/fs/streams": $ModuleValue<typeof import("./internal/fs/streams")>;
  "internal/fs/watch": $ModuleValue<typeof import("./internal/fs/watch")>;
  "internal/fs/watchfile": $ModuleValue<typeof import("./internal/fs/watchfile")>;
  "internal/html": $ModuleValue<typeof import("./internal/html")>;
  "internal/http": $ModuleValue<typeof import("./internal/http")>;
  "internal/http/FakeSocket": $ModuleValue<typeof import("./internal/http/FakeSocket")>;
  "internal/http1_server_fallback": $ModuleValue<typeof import("./internal/http1_server_fallback")>;
  "internal/inspector/cdp": $ModuleValue<typeof import("./internal/inspector/cdp")>;
  "internal/linkedlist": $ModuleValue<typeof import("./internal/linkedlist")>;
  "internal/net/isIP": $ModuleValue<typeof import("./internal/net/isIP")>;
  "internal/net/server_abort_signal": $ModuleValue<typeof import("./internal/net/server_abort_signal")>;
  "internal/net/symbols": $ModuleValue<typeof import("./internal/net/symbols")>;
  "internal/primordials": $ModuleValue<typeof import("./internal/primordials")>;
  "internal/process/next_tick_queue": $ModuleValue<typeof import("./internal/process/next_tick_queue")>;
  "internal/process/tick_ring": $ModuleValue<typeof import("./internal/process/tick_ring")>;
  "internal/process/pre_execution": $ModuleValue<typeof import("./internal/process/pre_execution")>;
  "internal/promisify": $ModuleValue<typeof import("./internal/promisify")>;
  "internal/quic/binding": $ModuleValue<typeof import("./internal/quic/binding")>;
  "internal/quic/diagnostics": $ModuleValue<typeof import("./internal/quic/diagnostics")>;
  "internal/quic/http2util": $ModuleValue<typeof import("./internal/quic/http2util")>;
  "internal/quic/quic": $ModuleValue<typeof import("./internal/quic/quic")>;
  "internal/quic/state": $ModuleValue<typeof import("./internal/quic/state")>;
  "internal/quic/stats": $ModuleValue<typeof import("./internal/quic/stats")>;
  "internal/quic/symbols": $ModuleValue<typeof import("./internal/quic/symbols")>;
  "internal/readline/callbacks": $ModuleValue<typeof import("./internal/readline/callbacks")>;
  "internal/readline/emitKeypressEvents": $ModuleValue<typeof import("./internal/readline/emitKeypressEvents")>;
  "internal/readline/interface": $ModuleValue<typeof import("./internal/readline/interface")>;
  "internal/readline/promises": $ModuleValue<typeof import("./internal/readline/promises")>;
  "internal/readline/utils": $ModuleValue<typeof import("./internal/readline/utils")>;
  "internal/repl": $ModuleValue<typeof import("./internal/repl")>;
  "internal/repl/acorn": $ModuleValue<typeof import("./internal/repl/acorn")>;
  "internal/repl/acorn-walk": $ModuleValue<typeof import("./internal/repl/acorn-walk")>;
  "internal/repl/await": $ModuleValue<typeof import("./internal/repl/await")>;
  "internal/repl/completion": $ModuleValue<typeof import("./internal/repl/completion")>;
  "internal/repl/history": $ModuleValue<typeof import("./internal/repl/history")>;
  "internal/repl/mode": $ModuleValue<typeof import("./internal/repl/mode")>;
  "internal/repl/node-errors": $ModuleValue<typeof import("./internal/repl/node-errors")>;
  "internal/repl/node-inspect": $ModuleValue<typeof import("./internal/repl/node-inspect")>;
  "internal/repl/node-primordials": $ModuleValue<typeof import("./internal/repl/node-primordials")>;
  "internal/repl/node-shims": $ModuleValue<typeof import("./internal/repl/node-shims")>;
  "internal/repl/utils": $ModuleValue<typeof import("./internal/repl/utils")>;
  "internal/serialization_buffers": $ModuleValue<typeof import("./internal/serialization_buffers")>;
  "internal/serve_cli": $ModuleValue<typeof import("./internal/serve_cli")>;
  "internal/shared": $ModuleValue<typeof import("./internal/shared")>;
  "internal/sql/errors": $ModuleValue<typeof import("./internal/sql/errors")>;
  "internal/sql/mysql": $ModuleValue<typeof import("./internal/sql/mysql")>;
  "internal/sql/options": $ModuleValue<typeof import("./internal/sql/options")>;
  "internal/sql/pool": $ModuleValue<typeof import("./internal/sql/pool")>;
  "internal/sql/postgres": $ModuleValue<typeof import("./internal/sql/postgres")>;
  "internal/sql/query": $ModuleValue<typeof import("./internal/sql/query")>;
  "internal/sql/shared": $ModuleValue<typeof import("./internal/sql/shared")>;
  "internal/sql/sqlite": $ModuleValue<typeof import("./internal/sql/sqlite")>;
  "internal/stream": $ModuleValue<typeof import("./internal/stream")>;
  "internal/stream/promises": $ModuleValue<typeof import("./internal/stream.promises")>;
  "internal/streams/add-abort-signal": $ModuleValue<typeof import("./internal/streams/add-abort-signal")>;
  "internal/streams/compose": $ModuleValue<typeof import("./internal/streams/compose")>;
  "internal/streams/destroy": $ModuleValue<typeof import("./internal/streams/destroy")>;
  "internal/streams/duplex": $ModuleValue<typeof import("./internal/streams/duplex")>;
  "internal/streams/duplexify": $ModuleValue<typeof import("./internal/streams/duplexify")>;
  "internal/streams/duplexpair": $ModuleValue<typeof import("./internal/streams/duplexpair")>;
  "internal/streams/end-of-stream": $ModuleValue<typeof import("./internal/streams/end-of-stream")>;
  "internal/streams/fast-utf8-stream": $ModuleValue<typeof import("./internal/streams/fast-utf8-stream")>;
  "internal/streams/from": $ModuleValue<typeof import("./internal/streams/from")>;
  "internal/streams/iter/broadcast": $ModuleValue<typeof import("./internal/streams/iter/broadcast")>;
  "internal/streams/iter/classic": $ModuleValue<typeof import("./internal/streams/iter/classic")>;
  "internal/streams/iter/consumers": $ModuleValue<typeof import("./internal/streams/iter/consumers")>;
  "internal/streams/iter/duplex": $ModuleValue<typeof import("./internal/streams/iter/duplex")>;
  "internal/streams/iter/from": $ModuleValue<typeof import("./internal/streams/iter/from")>;
  "internal/streams/iter/pull": $ModuleValue<typeof import("./internal/streams/iter/pull")>;
  "internal/streams/iter/push": $ModuleValue<typeof import("./internal/streams/iter/push")>;
  "internal/streams/iter/ringbuffer": $ModuleValue<typeof import("./internal/streams/iter/ringbuffer")>;
  "internal/streams/iter/share": $ModuleValue<typeof import("./internal/streams/iter/share")>;
  "internal/streams/iter/transform": $ModuleValue<typeof import("./internal/streams/iter/transform")>;
  "internal/streams/iter/types": $ModuleValue<typeof import("./internal/streams/iter/types")>;
  "internal/streams/iter/utils": $ModuleValue<typeof import("./internal/streams/iter/utils")>;
  "internal/streams/lazy_transform": $ModuleValue<typeof import("./internal/streams/lazy_transform")>;
  "internal/streams/legacy": $ModuleValue<typeof import("./internal/streams/legacy")>;
  "internal/streams/native-readable": $ModuleValue<typeof import("./internal/streams/native-readable")>;
  "internal/streams/operators": $ModuleValue<typeof import("./internal/streams/operators")>;
  "internal/streams/passthrough": $ModuleValue<typeof import("./internal/streams/passthrough")>;
  "internal/streams/pipeline": $ModuleValue<typeof import("./internal/streams/pipeline")>;
  "internal/streams/readable": $ModuleValue<typeof import("./internal/streams/readable")>;
  "internal/streams/state": $ModuleValue<typeof import("./internal/streams/state")>;
  "internal/streams/transform": $ModuleValue<typeof import("./internal/streams/transform")>;
  "internal/streams/utils": $ModuleValue<typeof import("./internal/streams/utils")>;
  "internal/streams/writable": $ModuleValue<typeof import("./internal/streams/writable")>;
  "internal/test/binding": $ModuleValue<typeof import("./internal/test/binding")>;
  "internal/test_runner/mock_timers": $ModuleValue<typeof import("./internal/test_runner/mock_timers")>;
  "internal/timers": $ModuleValue<typeof import("./internal/timers")>;
  "internal/tls": $ModuleValue<typeof import("./internal/tls")>;
  "internal/trace_event_recorder": $ModuleValue<typeof import("./internal/trace_event_recorder")>;
  "internal/trace_events": $ModuleValue<typeof import("./internal/trace_events")>;
  "internal/tty": $ModuleValue<typeof import("./internal/tty")>;
  "internal/url": $ModuleValue<typeof import("./internal/url")>;
  "internal/util/colors": $ModuleValue<typeof import("./internal/util/colors")>;
  "internal/util/comparisons": $ModuleValue<typeof import("./internal/util/comparisons")>;
  "internal/util/debuglog": $ModuleValue<typeof import("./internal/util/debuglog")>;
  "internal/util/deprecate": $ModuleValue<typeof import("./internal/util/deprecate")>;
  "internal/util/inspect": $ModuleValue<typeof import("./internal/util/inspect")>;
  "internal/util/mime": $ModuleValue<typeof import("./internal/util/mime")>;
  "internal/validators": $ModuleValue<typeof import("./internal/validators")>;
  "internal/webstreams_adapters": $ModuleValue<typeof import("./internal/webstreams_adapters")>;
  "internal/worker/messaging": $ModuleValue<typeof import("./internal/worker/messaging")>;
  "internal/worker/stdio": $ModuleValue<typeof import("./internal/worker/stdio")>;
  "isomorphic-fetch": $ModuleValue<typeof import("./thirdparty/isomorphic-fetch")>;
  "node-fetch": $ModuleValue<typeof import("./thirdparty/node-fetch")>;
  "node:_http_agent": $ModuleValue<typeof import("./node/_http_agent")>;
  "node:_http_client": $ModuleValue<typeof import("./node/_http_client")>;
  "node:_http_common": $ModuleValue<typeof import("./node/_http_common")>;
  "node:_http_incoming": $ModuleValue<typeof import("./node/_http_incoming")>;
  "node:_http_outgoing": $ModuleValue<typeof import("./node/_http_outgoing")>;
  "node:_http_server": $ModuleValue<typeof import("./node/_http_server")>;
  "node:_stream_duplex": $ModuleValue<typeof import("./node/_stream_duplex")>;
  "node:_stream_passthrough": $ModuleValue<typeof import("./node/_stream_passthrough")>;
  "node:_stream_readable": $ModuleValue<typeof import("./node/_stream_readable")>;
  "node:_stream_transform": $ModuleValue<typeof import("./node/_stream_transform")>;
  "node:_stream_wrap": $ModuleValue<typeof import("./node/_stream_wrap")>;
  "node:_stream_writable": $ModuleValue<typeof import("./node/_stream_writable")>;
  "node:_tls_common": $ModuleValue<typeof import("./node/_tls_common")>;
  "node:_tls_wrap": $ModuleValue<typeof import("./node/_tls_wrap")>;
  "node:assert": $ModuleValue<typeof import("./node/assert")>;
  "node:assert/strict": $ModuleValue<typeof import("./node/assert.strict")>;
  "node:async_hooks": $ModuleValue<typeof import("./node/async_hooks")>;
  "node:child_process": $ModuleValue<typeof import("./node/child_process")>;
  "node:cluster": $ModuleValue<typeof import("./node/cluster")>;
  "node:console": $ModuleValue<typeof import("./node/console")>;
  "node:crypto": $ModuleValue<typeof import("./node/crypto")>;
  "node:dgram": $ModuleValue<typeof import("./node/dgram")>;
  "node:diagnostics_channel": $ModuleValue<typeof import("./node/diagnostics_channel")>;
  "node:dns": $ModuleValue<typeof import("./node/dns")>;
  "node:dns/promises": $ModuleValue<typeof import("./node/dns.promises")>;
  "node:domain": $ModuleValue<typeof import("./node/domain")>;
  "node:events": $ModuleValue<typeof import("./node/events")>;
  "node:fs": $ModuleValue<typeof import("./node/fs")>;
  "node:fs/promises": $ModuleValue<typeof import("./node/fs.promises")>;
  "node:http": $ModuleValue<typeof import("./node/http")>;
  "node:http2": $ModuleValue<typeof import("./node/http2")>;
  "node:https": $ModuleValue<typeof import("./node/https")>;
  "node:inspector": $ModuleValue<typeof import("./node/inspector")>;
  "node:inspector/promises": $ModuleValue<typeof import("./node/inspector.promises")>;
  "node:net": $ModuleValue<typeof import("./node/net")>;
  "node:os": $ModuleValue<typeof import("./node/os")>;
  "node:path": $ModuleValue<typeof import("./node/path")>;
  "node:path/posix": $ModuleValue<typeof import("./node/path.posix")>;
  "node:path/win32": $ModuleValue<typeof import("./node/path.win32")>;
  "node:perf_hooks": $ModuleValue<typeof import("./node/perf_hooks")>;
  "node:punycode": $ModuleValue<typeof import("./node/punycode")>;
  "node:querystring": $ModuleValue<typeof import("./node/querystring")>;
  "node:quic": $ModuleValue<typeof import("./node/quic")>;
  "node:readline": $ModuleValue<typeof import("./node/readline")>;
  "node:readline/promises": $ModuleValue<typeof import("./node/readline.promises")>;
  "node:repl": $ModuleValue<typeof import("./node/repl")>;
  "node:stream": $ModuleValue<typeof import("./node/stream")>;
  "node:stream/consumers": $ModuleValue<typeof import("./node/stream.consumers")>;
  "node:stream/iter": $ModuleValue<typeof import("./node/stream.iter")>;
  "node:stream/promises": $ModuleValue<typeof import("./node/stream.promises")>;
  "node:stream/web": $ModuleValue<typeof import("./node/stream.web")>;
  "node:test": $ModuleValue<typeof import("./node/test")>;
  "node:timers": $ModuleValue<typeof import("./node/timers")>;
  "node:timers/promises": $ModuleValue<typeof import("./node/timers.promises")>;
  "node:tls": $ModuleValue<typeof import("./node/tls")>;
  "node:trace_events": $ModuleValue<typeof import("./node/trace_events")>;
  "node:tty": $ModuleValue<typeof import("./node/tty")>;
  "node:url": $ModuleValue<typeof import("./node/url")>;
  "node:util": $ModuleValue<typeof import("./node/util")>;
  "node:util/types": $Node.UtilTypes;
  "node:v8": $ModuleValue<typeof import("./node/v8")>;
  "node:vm": $ModuleValue<typeof import("./node/vm")>;
  "node:wasi": $ModuleValue<typeof import("./node/wasi")>;
  "node:worker_threads": $ModuleValue<typeof import("./node/worker_threads")>;
  "node:zlib": $ModuleValue<typeof import("./node/zlib")>;
  "node:zlib/iter": $ModuleValue<typeof import("./node/zlib.iter")>;
  "undici": $ModuleValue<typeof import("./thirdparty/undici")>;
  "ws": $ModuleValue<typeof import("./thirdparty/ws")>;
}
// The default matters: without one TypeScript takes the pattern of `const { a } = require("x")` as the call's return type while it infers T, which resolves `$BunModules[keyof $BunModules]`: every module then depends on every other.
declare function require<T extends keyof $BunModules = keyof $BunModules>(id: T): $BunModules[T];
declare function require(id: string): any;

// Native classes that the `node:` modules receive and create. The members are read off the native sources.
declare namespace $Node {
  // `node:util/types`: src/jsc/modules/NodeUtilTypesModule.cpp
  interface UtilTypes {
    isExternal(value: unknown): boolean;
    isDate(value: unknown): value is Date;
    isArgumentsObject(value: unknown): value is IArguments;
    isBigIntObject(value: unknown): value is BigInt;
    isBooleanObject(value: unknown): value is Boolean;
    isNumberObject(value: unknown): value is Number;
    isStringObject(value: unknown): value is String;
    isSymbolObject(value: unknown): value is Symbol;
    isNativeError(value: unknown): value is Error;
    isRegExp(value: unknown): value is RegExp;
    isAsyncFunction(value: unknown): boolean;
    isGeneratorFunction(value: unknown): value is GeneratorFunction;
    isGeneratorObject(value: unknown): value is Generator;
    isPromise(value: unknown): value is Promise<unknown>;
    isMap(value: unknown): value is Map<unknown, unknown>;
    isSet(value: unknown): value is Set<unknown>;
    isMapIterator(value: unknown): boolean;
    isSetIterator(value: unknown): boolean;
    isWeakMap(value: unknown): value is WeakMap<WeakKey, unknown>;
    isWeakSet(value: unknown): value is WeakSet<WeakKey>;
    isArrayBuffer(value: unknown): value is ArrayBuffer;
    isDataView(value: unknown): value is DataView;
    isSharedArrayBuffer(value: unknown): value is SharedArrayBuffer;
    isProxy(value: unknown): boolean;
    isModuleNamespaceObject(value: unknown): boolean;
    isAnyArrayBuffer(value: unknown): value is ArrayBuffer | SharedArrayBuffer;
    isBoxedPrimitive(value: unknown): value is Number | String | Boolean | BigInt | Symbol;
    isArrayBufferView(value: unknown): value is ArrayBufferView;
    isTypedArray(value: unknown): value is TypedArray;
    isUint8Array(value: unknown): value is Uint8Array;
    isUint8ClampedArray(value: unknown): value is Uint8ClampedArray;
    isUint16Array(value: unknown): value is Uint16Array;
    isUint32Array(value: unknown): value is Uint32Array;
    isInt8Array(value: unknown): value is Int8Array;
    isInt16Array(value: unknown): value is Int16Array;
    isInt32Array(value: unknown): value is Int32Array;
    isFloat16Array(value: unknown): value is Float16Array;
    isFloat32Array(value: unknown): value is Float32Array;
    isFloat64Array(value: unknown): value is Float64Array;
    isBigInt64Array(value: unknown): value is BigInt64Array;
    isBigUint64Array(value: unknown): value is BigUint64Array;
    isKeyObject(value: unknown): boolean;
    isCryptoKey(value: unknown): boolean;
    isEventTarget(value: unknown): boolean;
  }

  type TypedArray =
    | Uint8Array
    | Uint8ClampedArray
    | Uint16Array
    | Uint32Array
    | Int8Array
    | Int16Array
    | Int32Array
    | Float16Array
    | Float32Array
    | Float64Array
    | BigInt64Array
    | BigUint64Array;
}

declare namespace $Node {
  interface FileSink {
    _getFd(): number;
  }

  // node:fs. src/runtime/node/node_fs_binding.bind.ts (NodeJSFS), node_fs.rs, Stat.rs, StatFS.rs; src/jsc/bindings/NodeFSStatBinding.cpp, NodeDirent.cpp

  /** Any view, with `Buffer` said apart from `Uint8Array`: the compiler does not yet take a value of the class `Buffer` at a position that names only its parent. */
  type AnyView = Buffer | ArrayBufferView;
  type PathLike = string | Buffer | Uint8Array | URL;
  type TimeLike = number | string | Date;
  type EncodingOption = string | { encoding?: string | null } | null;
  /** Every encoding but "buffer". */
  type TextEncoding =
    | "utf8"
    | "utf-8"
    | "utf16le"
    | "utf-16le"
    | "ucs2"
    | "ucs-2"
    | "latin1"
    | "binary"
    | "ascii"
    | "base64"
    | "base64url"
    | "hex";
  type TextEncodingOption = TextEncoding | { encoding?: TextEncoding | null } | null;

  interface StatsOf<N> {
    dev: N;
    ino: N;
    mode: N;
    nlink: N;
    uid: N;
    gid: N;
    rdev: N;
    size: N;
    blksize: N;
    blocks: N;
    atimeMs: N;
    mtimeMs: N;
    ctimeMs: N;
    birthtimeMs: N;
    atime: Date;
    mtime: Date;
    ctime: Date;
    birthtime: Date;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isDirectory(): boolean;
    isFIFO(): boolean;
    isFile(): boolean;
    isSocket(): boolean;
    isSymbolicLink(): boolean;
  }
  interface Stats extends StatsOf<number> {}
  interface BigIntStats extends StatsOf<bigint> {
    atimeNs: bigint;
    mtimeNs: bigint;
    ctimeNs: bigint;
    birthtimeNs: bigint;
  }
  interface StatOptions {
    bigint?: boolean;
    throwIfNoEntry?: boolean;
    signal?: AbortSignal;
  }
  /** The options with which a `stat` answers a `Stats`, or throws. */
  interface NumberStatOptions extends StatOptions {
    bigint?: false;
    throwIfNoEntry?: true;
  }
  /** The options with which a `stat` answers a `BigIntStats`, or throws. */
  interface BigIntStatOptions extends StatOptions {
    bigint: true;
    throwIfNoEntry?: true;
  }

  interface StatFsOf<N> {
    type: N;
    bsize: N;
    blocks: N;
    bfree: N;
    bavail: N;
    files: N;
    ffree: N;
  }

  interface Dirent<Name = string> {
    name: Name;
    parentPath: string;
    path: string;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isDirectory(): boolean;
    isFIFO(): boolean;
    isFile(): boolean;
    isSocket(): boolean;
    isSymbolicLink(): boolean;
  }

  interface ReaddirOptions {
    encoding?: string | null;
    withFileTypes?: boolean;
    recursive?: boolean;
  }
  interface RmOptions {
    force?: boolean;
    maxRetries?: number;
    recursive?: boolean;
    retryDelay?: number;
  }
  interface MkdirOptions {
    recursive?: boolean;
    mode?: number | string;
  }
  type ReadFileOptions = string | { encoding?: string | null; flag?: string | number; signal?: AbortSignal } | null;
  type WriteFileOptions =
    | string
    | {
        encoding?: string | null;
        mode?: number | string;
        flag?: string | number;
        flush?: boolean;
        signal?: AbortSignal;
      }
    | null;
  type FileData = string | AnyView;

  /** The operations of the native binding that answer a promise. Each has a callback arm: see `NodeJSFS`. */
  interface NodeJSFSPromises {
    access(path: PathLike, mode?: number): Promise<void>;
    appendFile(path: PathLike | number, data: FileData, options?: WriteFileOptions): Promise<void>;
    chmod(path: PathLike, mode: number | string): Promise<void>;
    chown(path: PathLike, uid: number, gid: number): Promise<void>;
    close(fd: number): Promise<void>;
    copyFile(source: PathLike, destination: PathLike, mode?: number): Promise<void>;
    exists(path: PathLike): Promise<boolean>;
    fchmod(fd: number, mode: number | string): Promise<void>;
    fchown(fd: number, uid: number, gid: number): Promise<void>;
    fdatasync(fd: number): Promise<void>;
    fstat(fd: number, options?: NumberStatOptions): Promise<Stats>;
    fstat(fd: number, options: BigIntStatOptions): Promise<BigIntStats>;
    fstat(fd: number, options: StatOptions | undefined): Promise<Stats | BigIntStats>;
    fsync(fd: number): Promise<void>;
    ftruncate(fd: number, length?: number | null): Promise<void>;
    futimes(fd: number, atime: TimeLike, mtime: TimeLike): Promise<void>;
    lchmod(path: PathLike, mode: number | string): Promise<void>;
    lchown(path: PathLike, uid: number, gid: number): Promise<void>;
    link(existingPath: PathLike, newPath: PathLike): Promise<void>;
    lstat(path: PathLike, options?: NumberStatOptions): Promise<Stats>;
    lstat(path: PathLike, options: BigIntStatOptions): Promise<BigIntStats>;
    lstat(path: PathLike, options: StatOptions | undefined): Promise<Stats | BigIntStats | undefined>;
    lutimes(path: PathLike, atime: TimeLike, mtime: TimeLike): Promise<void>;
    /** With `recursive`: the first directory that was created, if any. */
    mkdir(path: PathLike, options?: MkdirOptions | number | string | null): Promise<string | undefined>;
    mkdtemp(prefix: PathLike, options?: TextEncodingOption): Promise<string>;
    mkdtemp(prefix: PathLike, options: EncodingOption | undefined): Promise<string | Buffer>;
    open(path: PathLike, flags?: string | number, mode?: number | string): Promise<number>;
    read(
      fd: number,
      buffer: AnyView,
      offset?: number,
      length?: number,
      position?: number | bigint | null,
    ): Promise<number>;
    readdir(path: PathLike): Promise<string[]>;
    readdir(path: PathLike, options: ReaddirOptions & { withFileTypes: true }): Promise<Dirent[]>;
    readdir(
      path: PathLike,
      options: ReaddirOptions | string | null | undefined,
    ): Promise<string[] | Buffer[] | Dirent[]>;
    readFile(path: PathLike | number): Promise<Buffer>;
    readFile(path: PathLike | number, options: TextEncoding | { encoding: TextEncoding }): Promise<string>;
    readFile(path: PathLike | number, options: ReadFileOptions | undefined): Promise<string | Buffer>;
    readlink(path: PathLike, options?: TextEncodingOption): Promise<string>;
    readlink(path: PathLike, options: EncodingOption | undefined): Promise<string | Buffer>;
    readv(fd: number, buffers: readonly AnyView[], position?: number | null): Promise<number>;
    realpath(path: PathLike, options?: TextEncodingOption): Promise<string>;
    realpath(path: PathLike, options: EncodingOption | undefined): Promise<string | Buffer>;
    realpathNative(path: PathLike, options?: TextEncodingOption): Promise<string>;
    realpathNative(path: PathLike, options: EncodingOption | undefined): Promise<string | Buffer>;
    rename(oldPath: PathLike, newPath: PathLike): Promise<void>;
    rm(path: PathLike, options?: RmOptions): Promise<void>;
    rmdir(path: PathLike, options?: RmOptions): Promise<void>;
    stat(path: PathLike, options?: NumberStatOptions): Promise<Stats>;
    stat(path: PathLike, options: BigIntStatOptions): Promise<BigIntStats>;
    stat(path: PathLike, options: StatOptions | undefined): Promise<Stats | BigIntStats | undefined>;
    statfs(path: PathLike, options?: { bigint?: false }): Promise<StatFsOf<number>>;
    statfs(path: PathLike, options: { bigint?: boolean } | undefined): Promise<StatFsOf<number> | StatFsOf<bigint>>;
    symlink(target: PathLike, path: PathLike, type?: string | null): Promise<void>;
    truncate(path: PathLike, length?: number | null): Promise<void>;
    unlink(path: PathLike): Promise<void>;
    utimes(path: PathLike, atime: TimeLike, mtime: TimeLike): Promise<void>;
    write(
      fd: number,
      buffer: AnyView,
      offset?: number | null,
      length?: number | null,
      position?: number | bigint | null,
    ): Promise<number>;
    write(fd: number, string: string, position?: number | null, encoding?: string | null): Promise<number>;
    write(
      fd: number,
      data: string | AnyView,
      offsetOrPosition?: number | null,
      lengthOrEncoding?: number | string | null,
      position?: number | bigint | null,
    ): Promise<number>;
    writeFile(path: PathLike | number, data: FileData, options?: WriteFileOptions): Promise<void>;
    writev(fd: number, buffers: readonly AnyView[], position?: number | null): Promise<number>;
  }

  /** `xCb(callback, ...arguments of x)`. The error is `null` when the operation succeeded. */
  type NodeJSFSCallbacks = {
    [K in Exclude<keyof NodeJSFSPromises, "write"> as `${K}Cb`]: NodeJSFSPromises[K] extends (
      ...args: infer A
    ) => Promise<infer R>
      ? (callback: (error: Error | null, result: R) => unknown, ...args: A) => void
      : never;
  };

  interface NodeJSFS extends NodeJSFSPromises, NodeJSFSCallbacks {
    writeCb(
      callback: (error: Error | null, bytesWritten: number) => unknown,
      fd: number,
      buffer: AnyView,
      offset?: number | null,
      length?: number | null,
      position?: number | bigint | null,
    ): void;
    writeCb(
      callback: (error: Error | null, bytesWritten: number) => unknown,
      fd: number,
      string: string,
      position?: number | null,
      encoding?: string | null,
    ): void;
    accessSync(path: PathLike, mode?: number): void;
    appendFileSync(path: PathLike | number, data: FileData, options?: WriteFileOptions): void;
    chmodSync(path: PathLike, mode: number | string): void;
    chownSync(path: PathLike, uid: number, gid: number): void;
    closeSync(fd: number): void;
    copyFileSync(source: PathLike, destination: PathLike, mode?: number): void;
    cp(
      source: string,
      destination: string,
      recursive: boolean,
      errorOnExist: boolean,
      force: boolean,
      mode: number,
    ): Promise<void>;
    cpSync(
      source: string,
      destination: string,
      recursive: boolean,
      errorOnExist: boolean,
      force: boolean,
      mode: number,
    ): void;
    existsSync(path: PathLike): boolean;
    fchmodSync(fd: number, mode: number | string): void;
    fchownSync(fd: number, uid: number, gid: number): void;
    fdatasyncSync(fd: number): void;
    fstatSync(fd: number, options?: NumberStatOptions): Stats;
    fstatSync(fd: number, options: BigIntStatOptions): BigIntStats;
    fstatSync(fd: number, options: StatOptions | undefined): Stats | BigIntStats;
    fsyncSync(fd: number): void;
    ftruncateSync(fd: number, length?: number | null): void;
    futimesSync(fd: number, atime: TimeLike, mtime: TimeLike): void;
    lchmodSync(path: PathLike, mode: number | string): void;
    lchownSync(path: PathLike, uid: number, gid: number): void;
    linkSync(existingPath: PathLike, newPath: PathLike): void;
    lstatSync(path: PathLike, options?: NumberStatOptions): Stats;
    lstatSync(path: PathLike, options: BigIntStatOptions): BigIntStats;
    lstatSync(path: PathLike, options: StatOptions | undefined): Stats | BigIntStats | undefined;
    lutimesSync(path: PathLike, atime: TimeLike, mtime: TimeLike): void;
    mkdirSync(path: PathLike, options?: MkdirOptions | number | string | null): string | undefined;
    mkdtempSync(prefix: PathLike, options?: TextEncodingOption): string;
    mkdtempSync(prefix: PathLike, options: EncodingOption | undefined): string | Buffer;
    openSync(path: PathLike, flags?: string | number, mode?: number | string): number;
    readdirSync(path: PathLike): string[];
    readdirSync(path: PathLike, options: ReaddirOptions & { withFileTypes: true }): Dirent[];
    readdirSync(path: PathLike, options: ReaddirOptions | string | null | undefined): string[] | Buffer[] | Dirent[];
    readFileSync(path: PathLike | number): Buffer;
    readFileSync(path: PathLike | number, options: TextEncoding | { encoding: TextEncoding }): string;
    readFileSync(path: PathLike | number, options: ReadFileOptions | undefined): string | Buffer;
    readlinkSync(path: PathLike, options?: TextEncodingOption): string;
    readlinkSync(path: PathLike, options: EncodingOption | undefined): string | Buffer;
    readSync(fd: number, buffer: AnyView, offset?: number, length?: number, position?: number | bigint | null): number;
    readvSync(fd: number, buffers: readonly AnyView[], position?: number | null): number;
    realpathSync(path: PathLike, options?: TextEncodingOption): string;
    realpathSync(path: PathLike, options: EncodingOption | undefined): string | Buffer;
    realpathNativeSync(path: PathLike, options?: TextEncodingOption): string;
    realpathNativeSync(path: PathLike, options: EncodingOption | undefined): string | Buffer;
    renameSync(oldPath: PathLike, newPath: PathLike): void;
    rmSync(path: PathLike, options?: RmOptions): void;
    rmdirSync(path: PathLike, options?: RmOptions): void;
    statSync(path: PathLike, options?: NumberStatOptions): Stats;
    statSync(path: PathLike, options: BigIntStatOptions): BigIntStats;
    statSync(path: PathLike, options: StatOptions | undefined): Stats | BigIntStats | undefined;
    statfsSync(path: PathLike, options?: { bigint?: false }): StatFsOf<number>;
    statfsSync(path: PathLike, options: { bigint?: boolean } | undefined): StatFsOf<number> | StatFsOf<bigint>;
    symlinkSync(target: PathLike, path: PathLike, type?: string | null): void;
    truncateSync(path: PathLike | number, length?: number | null): void;
    unlinkSync(path: PathLike): void;
    utimesSync(path: PathLike, atime: TimeLike, mtime: TimeLike): void;
    writeFileSync(path: PathLike | number, data: FileData, options?: WriteFileOptions): void;
    writeSync(
      fd: number,
      buffer: AnyView,
      offset?: number | null,
      length?: number | null,
      position?: number | bigint | null,
    ): number;
    writeSync(fd: number, string: string, position?: number | null, encoding?: string | null): number;
    writeSync(
      fd: number,
      data: string | AnyView,
      offsetOrPosition?: number | null,
      lengthOrEncoding?: number | string | null,
      position?: number | bigint | null,
    ): number;
    writevSync(fd: number, buffers: readonly AnyView[], position?: number | null): number;
    watch(
      path: PathLike,
      options: WatchOptions,
      listener: (eventType: string, filename: string | Buffer | Error | undefined) => void,
    ): $Bindgen.FSWatcher;
    watchFile(
      path: PathLike,
      options: WatchFileOptions | undefined,
      listener: (current: Stats | BigIntStats, previous: Stats | BigIntStats) => void,
    ): $Bindgen.StatWatcher;
    readonly Dirent: new (name: string, type: number, path: string) => Dirent;
    readonly Stats: new (...fields: number[]) => Stats;
  }

  interface WatchOptions {
    encoding?: string | null;
    persistent?: boolean;
    recursive?: boolean;
    signal?: AbortSignal;
  }
  interface WatchFileOptions {
    bigint?: boolean;
    persistent?: boolean;
    interval?: number;
  }
}

interface AddEventListenerOptions {
  // Builtins write option bags as `{ __proto__: null, ... }`.
  __proto__?: null;
  capture?: boolean;
  once?: boolean;
  passive?: boolean;
  signal?: AbortSignal;
}

// src/runtime/node/node_fs_watcher.bind.ts, node_fs_stat_watcher.bind.ts
declare namespace $Bindgen {
  interface FSWatcher {
    ref(): void;
    unref(): void;
    close(): void;
  }
  interface StatWatcher {
    ref(): void;
    unref(): void;
    close(): void;
  }
}

// src/runtime/node/node_zlib_binding.bind.ts, node_zlib_binding.rs, zlib/*.rs
declare namespace $Bindgen {
  /** What `NativeZlib`, `NativeBrotli` and `NativeZstd` share. */
  interface CompressionStream {
    /** Called with the handle as `this`. */
    onerror: ((message: string, errno: number, code: string) => void) | undefined;
    /** Runs on the thread pool, then calls the `writeCallback` given to `init` with the handle as `this`. */
    write(
      flush: number,
      input: $Node.AnyView | null,
      inputOffset: number,
      inputLength: number,
      output: $Node.AnyView,
      outputOffset: number,
      outputLength: number,
    ): void;
    writeSync(
      flush: number,
      input: $Node.AnyView | null,
      inputOffset: number,
      inputLength: number,
      output: $Node.AnyView,
      outputOffset: number,
      outputLength: number,
    ): void;
    params(level: number, strategy: number): void;
    reset(): void;
    close(): void;
  }
  interface NativeZlib extends CompressionStream {
    /** `writeResult` receives [bytes left in the output, bytes left in the input]. */
    init(
      windowBits: number,
      level: number,
      memLevel: number,
      strategy: number,
      writeResult: Uint32Array,
      writeCallback: () => void,
      dictionary: $Node.AnyView | undefined,
    ): void;
  }
  interface NativeBrotli extends CompressionStream {
    init(params: Uint32Array, writeResult: Uint32Array, writeCallback: () => void, dictionary?: $Node.AnyView): boolean;
  }
  interface NativeZstd extends CompressionStream {
    init(
      params: Uint32Array,
      pledgedSourceSize: number | undefined,
      writeResult: Uint32Array,
      writeCallback: () => void,
      dictionary?: $Node.AnyView,
    ): void;
  }
  interface CompressionStreamConstructor<T> {
    new (mode: number): T;
    prototype: T;
  }
}

// Host classes under their public names: the names programs use, and the ones that the table of built-ins knows the native classes by.

// src/jsc/bindings/JSBuffer.cpp, src/js/builtins/JSBufferPrototype.ts
interface Buffer<TArrayBuffer extends ArrayBufferLike = ArrayBufferLike> extends Uint8Array<TArrayBuffer> {
  readonly parent: ArrayBufferLike | undefined;
  readonly offset: number | undefined;
  toString(encoding?: string | null, start?: number, end?: number): string;
  toJSON(): { type: "Buffer"; data: number[] };
  inspect(): string;
  equals(other: Buffer | Uint8Array): boolean;
  compare(
    target: Buffer | Uint8Array,
    targetStart?: number,
    targetEnd?: number,
    sourceStart?: number,
    sourceEnd?: number,
  ): -1 | 0 | 1;
  copy(target: Buffer | Uint8Array, targetStart?: number, sourceStart?: number, sourceEnd?: number): number;
  /** A view of the same memory, as `subarray` is. */
  slice(start?: number, end?: number): Buffer<ArrayBuffer>;
  subarray(start?: number, end?: number): Buffer<TArrayBuffer>;
  fill(
    value: string | number | Buffer | Uint8Array,
    offset?: number | string,
    end?: number | string,
    encoding?: string,
  ): this;
  indexOf(value: string | number | Buffer | Uint8Array, byteOffset?: number | string, encoding?: string): number;
  lastIndexOf(value: string | number | Buffer | Uint8Array, byteOffset?: number | string, encoding?: string): number;
  includes(value: string | number | Buffer | Uint8Array, byteOffset?: number | string, encoding?: string): boolean;
  swap16(): this;
  swap32(): this;
  swap64(): this;
  write(string: string, encoding?: string): number;
  write(string: string, offset: number, encoding?: string): number;
  write(string: string, offset: number, length: number, encoding?: string): number;
  asciiSlice(start?: number, end?: number): string;
  base64Slice(start?: number, end?: number): string;
  base64urlSlice(start?: number, end?: number): string;
  hexSlice(start?: number, end?: number): string;
  latin1Slice(start?: number, end?: number): string;
  ucs2Slice(start?: number, end?: number): string;
  utf16leSlice(start?: number, end?: number): string;
  utf8Slice(start?: number, end?: number): string;
  asciiWrite(string: string, offset?: number, length?: number): number;
  base64Write(string: string, offset?: number, length?: number): number;
  base64urlWrite(string: string, offset?: number, length?: number): number;
  hexWrite(string: string, offset?: number, length?: number): number;
  latin1Write(string: string, offset?: number, length?: number): number;
  ucs2Write(string: string, offset?: number, length?: number): number;
  utf16leWrite(string: string, offset?: number, length?: number): number;
  utf8Write(string: string, offset?: number, length?: number): number;
  readBigInt64BE(offset?: number): bigint;
  readBigInt64LE(offset?: number): bigint;
  readBigUInt64BE(offset?: number): bigint;
  readBigUInt64LE(offset?: number): bigint;
  readDoubleBE(offset?: number): number;
  readDoubleLE(offset?: number): number;
  readFloatBE(offset?: number): number;
  readFloatLE(offset?: number): number;
  readInt8(offset?: number): number;
  readInt16BE(offset?: number): number;
  readInt16LE(offset?: number): number;
  readInt32BE(offset?: number): number;
  readInt32LE(offset?: number): number;
  readIntBE(offset: number, byteLength: number): number;
  readIntLE(offset: number, byteLength: number): number;
  readUInt8(offset?: number): number;
  readUInt16BE(offset?: number): number;
  readUInt16LE(offset?: number): number;
  readUInt32BE(offset?: number): number;
  readUInt32LE(offset?: number): number;
  readUIntBE(offset: number, byteLength: number): number;
  readUIntLE(offset: number, byteLength: number): number;
  writeBigInt64BE(value: bigint, offset?: number): number;
  writeBigInt64LE(value: bigint, offset?: number): number;
  writeBigUInt64BE(value: bigint, offset?: number): number;
  writeBigUInt64LE(value: bigint, offset?: number): number;
  writeDoubleBE(value: number, offset?: number): number;
  writeDoubleLE(value: number, offset?: number): number;
  writeFloatBE(value: number, offset?: number): number;
  writeFloatLE(value: number, offset?: number): number;
  writeInt8(value: number, offset?: number): number;
  writeInt16BE(value: number, offset?: number): number;
  writeInt16LE(value: number, offset?: number): number;
  writeInt32BE(value: number, offset?: number): number;
  writeInt32LE(value: number, offset?: number): number;
  writeIntBE(value: number, offset: number, byteLength: number): number;
  writeIntLE(value: number, offset: number, byteLength: number): number;
  writeUInt8(value: number, offset?: number): number;
  writeUInt16BE(value: number, offset?: number): number;
  writeUInt16LE(value: number, offset?: number): number;
  writeUInt32BE(value: number, offset?: number): number;
  writeUInt32LE(value: number, offset?: number): number;
  writeUIntBE(value: number, offset: number, byteLength: number): number;
  writeUIntLE(value: number, offset: number, byteLength: number): number;
}
interface BufferConstructor {
  new (size: number): Buffer;
  new (string: string, encoding?: string | null): Buffer;
  new (data: ArrayLike<number> | ArrayBufferLike): Buffer;
  (size: number): Buffer;
  (string: string, encoding?: string | null): Buffer;
  (data: ArrayLike<number> | ArrayBufferLike): Buffer;
  readonly prototype: Buffer;
  poolSize: number;
  alloc(size: number, fill?: string | number | Uint8Array, encoding?: string | null): Buffer;
  allocUnsafe(size: number): Buffer;
  allocUnsafeSlow(size: number): Buffer;
  byteLength(value: string | ArrayBufferView | ArrayBufferLike, encoding?: string | null): number;
  compare(first: Uint8Array, second: Uint8Array): -1 | 0 | 1;
  concat(list: readonly Uint8Array[], totalLength?: number): Buffer;
  copyBytesFrom(view: ArrayBufferView, offset?: number, length?: number): Buffer;
  from(arrayBuffer: ArrayBufferLike, byteOffset?: number, length?: number): Buffer;
  from(data: ArrayLike<number>): Buffer;
  from(string: string, encoding?: string | null): Buffer;
  from(
    object: { valueOf(): string | object } | { [Symbol.toPrimitive](hint: "string"): string },
    offsetOrEncoding?: number | string,
    length?: number,
  ): Buffer;
  isBuffer(value: unknown): value is Buffer;
  isEncoding(encoding: unknown): boolean;
  of(...items: number[]): Buffer;
}
// `any` until the compiler takes a `Buffer` where a `Uint8Array` is declared: with `BufferConstructor` here, `chunk = Buffer.concat(..)` into a `Uint8Array` variable stops every build.
declare var Buffer: any;

// src/runtime/webcore/Blob.rs, Blob.bind.ts
interface Blob {
  readonly size: number;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
  bytes(): Promise<Uint8Array<ArrayBuffer>>;
  formData(): Promise<FormData>;
  json(): Promise<unknown>;
  slice(start?: number, end?: number, contentType?: string): Blob;
  stream(chunkSize?: number): ReadableStream<Uint8Array<ArrayBuffer>>;
  text(): Promise<string>;
}
declare var Blob: {
  new (
    parts?: Array<string | ArrayBufferLike | ArrayBufferView | Blob>,
    options?: { type?: string; endings?: "transparent" | "native" },
  ): Blob;
  prototype: Blob;
};

// src/jsc/bindings/webcore/JSDOMURL.cpp
interface URL {
  href: string;
  readonly origin: string;
  protocol: string;
  username: string;
  password: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  hash: string;
  search: string;
  readonly searchParams: URLSearchParams;
  toJSON(): string;
  toString(): string;
}

declare var URL: {
  new (url: string | URL, base?: string | URL): URL;
  prototype: URL;
  parse(url: string | URL, base?: string | URL): URL | null;
  canParse(url: string | URL, base?: string | URL): boolean;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
};

// src/jsc/bindings/webcore/JSURLSearchParams.cpp
interface URLSearchParams {
  append(name: string, value: string): void;
  delete(name: string, value?: string): void;
  get(name: string): string | null;
  getAll(name: string): string[];
  has(name: string, value?: string): boolean;
  set(name: string, value: string): void;
  sort(): void;
  entries(): IterableIterator<[string, string]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
  forEach(callback: (value: string, name: string, parent: URLSearchParams) => void, thisArg?: unknown): void;
  toString(): string;
  /** A name that occurs more than once has the list of its values. */
  toJSON(): Record<string, string | string[]>;
  readonly size: number;
  [Symbol.iterator](): IterableIterator<[string, string]>;
}

declare var URLSearchParams: {
  new (
    init?: string | URLSearchParams | Record<string, string | readonly string[]> | Iterable<[string, string]>,
  ): URLSearchParams;
  prototype: URLSearchParams;
};

// #region node:http
declare namespace $Node {
  interface SocketAddressInfo {
    address: string;
    family: string;
    port: number;
  }

  /** Of a request or a response that came in. The native listener builds the object for a request it parsed. */
  interface IncomingHttpHeaders {
    "set-cookie"?: string[];
    [name: string]: string | string[] | undefined;
  }

  /** What `ServerResponse` calls on the object that puts its bytes on the wire: a `NodeHTTPResponse`, or the stand-in of `internal/http1_server_fallback`. */
  interface HttpResponseHandle {
    /** `NodeHTTPResponseFlags` */
    readonly flags: number;
    readonly finished: boolean;
    readonly aborted: boolean;
    readonly bufferedAmount: number;
    get onwritable(): HttpDrainCallback | undefined;
    set onwritable(callback: HttpDrainCallback | null | undefined);
    cork(callback: () => void): void;
    writeContinue(): void;
    writeInformational(chunk: HttpChunk, encoding?: string | null): void;
    writeHead(
      statusCode: number,
      statusMessage: string | undefined,
      headers: string[],
      autoHeaderBits: number,
      keepAliveTimeoutSecs: number,
    ): void;
    /** The length of the body, or `-(length + 1)` while a part of it still waits for the socket to drain. */
    writeHeadAndEnd(
      statusCode: number,
      statusMessage: string | undefined,
      headers: string[],
      chunk: HttpChunk | null | undefined,
      encoding: string | null | undefined,
      strictContentLength: number | undefined,
      autoHeaderBits: number,
      keepAliveTimeoutSecs: number,
    ): number;
    /** `writeHeadAndEnd` where the arguments are the usual ones. `undefined`: nothing was written. */
    writeWholeResponse(
      statusCode: number,
      statusMessage: string | undefined,
      headers: string[],
      chunk: HttpChunk | null | undefined,
      encoding: string | null | undefined,
      strictContentLength: number | undefined,
      autoHeaderBits: number,
      keepAliveTimeoutSecs: number,
    ): number | undefined;
    /** Negative when the socket did not take all of it: `callback` runs once it has drained. */
    write(
      chunk: HttpChunk | null | undefined,
      encoding: string | null | undefined,
      callback: HttpDrainCallback | null | undefined,
      strictContentLength: number | undefined,
    ): number;
    end(
      chunk: HttpChunk | null | undefined,
      encoding: string | null | undefined,
      callback: undefined,
      strictContentLength: number | undefined,
    ): number;
    flushHeaders(): void;
    abort(): void;
  }

  /** The native class `NodeHTTPResponse` (src/runtime/server/NodeHTTPResponse.rs): one request and its response. */
  interface NodeHTTPResponse extends HttpResponseHandle {
    /** `NodeHTTPBodyReadState` */
    readonly hasBody: number;
    readonly upgraded: boolean;
    /** `event` is a `NodeHTTPResponseAbortEvent`. */
    ondata: ((chunk: Buffer | undefined, isLast: boolean, event: number) => void) | undefined;
    onabort: ((event: number) => void) | undefined;
    getBytesWritten(): number;
    ref(): void;
    unref(): void;
    pause(): boolean;
    resume(): boolean;
    pauseReads(): void;
    notifyWhenReadParsed(): boolean;
    takeRequestTrailers(lenient: boolean): string[] | undefined;
    takeRawHeaders(headers: IncomingHttpHeaders | null): string[] | undefined;
    headersObject(): IncomingHttpHeaders | undefined;
    /** No member of the native class. The server's socket asks for it in `_onTimeout()`. */
    readonly writableLength?: number;
  }

  /** The native class `NodeHTTPServerSocket` (src/jsc/bindings/node/JSNodeHTTPServerSocket.cpp): one connection. */
  interface NodeHTTPServerSocket {
    onclose: (() => void) | undefined;
    ondrain: (() => void) | undefined;
    ondata: ((chunk: Buffer | undefined, last: boolean) => void) | undefined;
    duplex: HttpServerSocket | null;
    readonly bytesWritten: number;
    readonly closed: boolean;
    readonly response: NodeHTTPResponse | null;
    readonly remoteAddress: SocketAddressInfo | null;
    readonly localAddress: SocketAddressInfo | null;
    readonly secureEstablished: boolean;
    readonly servername: string | null;
    readonly authorizationError: string | null;
    readonly peerCertVerified: boolean;
    readonly hasQueuedTunnelReads: boolean;
    readonly closedWithUnsentData: boolean | undefined;
    readonly closeError: (Error & { errno: number; code: string }) | undefined;
    readonly peerEnded: boolean;
    /** The FIN of `end()` has left, rather than waiting for queued bytes. */
    readonly finSent: boolean;
    /** No member of the native class. The server asks for it where it reports a dropped connection. */
    readonly localPort?: number;
    close(): void;
    reset(): void;
    /** Whether the kernel took all of it. */
    write(data: HttpChunk | undefined, encoding?: string | null): boolean | number;
    end(destroySoon?: boolean): void;
    upgradeToTunnel(hasBody: boolean, response: NodeHTTPResponse): void;
    readStop(): void;
    readStart(): void;
    setResponseTrailers(trailers: string): void;
    isRequestTimedOut(headersTimeout: number, requestTimeout: number): boolean;
    startPipelinedResponse(response: HttpResponseHandle, isAncient: boolean, connectionClose: boolean): boolean;
    stopParsing(): void;
    closeWhenDrained(): void;
    closeIfIdle(): boolean;
  }

  interface Timeout {
    _idleTimeout: number;
  }

  /** What `Bun.serve()` returns: the native classes `HTTPServer`, `HTTPSServer`, `DebugHTTPServer`, `DebugHTTPSServer`. */
  interface NativeHTTPServer {
    readonly address: SocketAddressInfo | string | null;
    readonly hostname: string | undefined;
    readonly port: number | undefined;
    ref(): void;
    unref(): void;
    stop(closeActiveConnections?: boolean): Promise<void>;
    /** How many connections it closed. */
    closeIdleConnections(): number;
    requestIP(request: Request): SocketAddressInfo | null;
  }

  interface HTTPParserError extends Error {
    bytesParsed: number;
    code: string;
    reason: string;
    rawPacket?: Buffer | Uint8Array;
  }

  type HTTPParserCallback =
    // kOnMessageBegin, kOnMessageComplete, kOnTimeout
    | ((this: HTTPParser) => void)
    // kOnHeaders
    | ((this: HTTPParser, headers: string[], url: string) => void)
    // kOnHeadersComplete
    | ((
        this: HTTPParser,
        versionMajor: number,
        versionMinor: number,
        headers: string[] | undefined,
        method: number | undefined,
        url: string | undefined,
        statusCode: number | undefined,
        statusMessage: string | undefined,
        upgrade: boolean,
        shouldKeepAlive: boolean,
      ) => number)
    // kOnBody
    | ((this: HTTPParser, chunk: Buffer) => void)
    // kOnExecute
    | ((this: HTTPParser, result: number | HTTPParserError) => void);

  /** The native class `HTTPParser` of `process.binding("http_parser")`, with the fields `node:_http_common` keeps on it. */
  interface HTTPParser {
    _headers: string[];
    _url: string;
    socket: HttpSocket | null;
    incoming: IncomingMessage | null;
    outgoing: ClientRequest | null;
    maxHeaderPairs: number;
    _consumed: boolean;
    onIncoming: ((incoming: IncomingMessage, shouldKeepAlive: boolean) => number) | null;
    joinDuplicateHeaders: boolean | null | undefined;
    [callback: number]: HTTPParserCallback | null;
    close(): void;
    free(): void;
    remove(): void;
    execute(data: Buffer | ArrayBufferView): number | HTTPParserError | undefined;
    finish(): HTTPParserError | undefined;
    initialize(
      type: number,
      resource: object,
      maxHeaderSize?: number,
      lenientFlags?: number,
      connections?: object | null,
    ): void;
    pause(): void;
    resume(): void;
    consume(handle: object): void;
    unconsume(): void;
    getCurrentBuffer(): Buffer | undefined;
    duration(): number | undefined;
    headersCompleted(): boolean | undefined;
  }
}
declare module "bun" {
  // src/runtime/crypto/CryptoHasher.rs: what `node:https` calls.
  interface CryptoHasher {
    update(input: string | ArrayBufferView | ArrayBufferLike, inputEncoding?: string): this;
    digest(encoding: string): string;
  }
}
declare namespace $Node {
  interface ReaddirOptions {
    __proto__?: null;
  }

  /** The native class `NodeVMScript` (src/jsc/bindings/NodeVMScript.cpp): `vm.Script`. */
  interface NodeVMScript {
    readonly sourceMapURL: string | undefined;
    readonly cachedData: Buffer | undefined;
    readonly cachedDataProduced: boolean | undefined;
    readonly cachedDataRejected: boolean | undefined;
    createCachedData(): Buffer;
    runInContext(context: object | symbol, options?: object): unknown;
    runInNewContext(context?: object | symbol, options?: object): unknown;
    runInThisContext(options?: object): unknown;
  }

  /** The native class `NodeVMModule` (src/jsc/bindings/NodeVMModule.cpp): what a `vm.Module` wraps. */
  interface NodeVMModule {
    readonly identifier: string;
    getStatusCode(): number;
    getStatus(): string;
    getNamespace(): object;
    getError(): unknown;
    instantiate(): void;
    /** A promise for a source text module. */
    evaluate(timeout: number, breakOnSigint: boolean): unknown;
    link(specifiers: string[], modules: NodeVMModule[], scriptFetcher: number): void;
    createCachedData(): Buffer;
    setExport(name: string, value: unknown): void;
    createModuleRecord(): { specifier: string; attributes: object }[];
    hasTopLevelAwait(): boolean;
    hasAsyncGraph(): boolean;
  }
}
declare module "node:string_decoder" {
  interface StringDecoder {
    write(buffer: Buffer): string;
    end(buffer: Buffer): string;
  }
}
// #endregion node:http

// src/jsc/bindings/webcore/JSPerformance*.cpp.
interface PerformanceEntry {
  readonly name: string;
  readonly entryType: string;
  readonly startTime: number;
  readonly duration: number;
  toJSON(): object;
}
declare var PerformanceEntry: { prototype: PerformanceEntry; new (): PerformanceEntry };
interface PerformanceMark extends PerformanceEntry {
  readonly detail: unknown;
}
declare var PerformanceMark: {
  prototype: PerformanceMark;
  new (name: string, options?: { detail?: unknown; startTime?: number }): PerformanceMark;
};
interface PerformanceMeasure extends PerformanceEntry {
  readonly detail: unknown;
}
declare var PerformanceMeasure: { prototype: PerformanceMeasure; new (): PerformanceMeasure };
interface PerformanceResourceTiming extends PerformanceEntry {
  readonly initiatorType: string;
  readonly nextHopProtocol: string;
  readonly workerStart: number;
  readonly redirectStart: number;
  readonly redirectEnd: number;
  readonly fetchStart: number;
  readonly domainLookupStart: number;
  readonly domainLookupEnd: number;
  readonly connectStart: number;
  readonly connectEnd: number;
  readonly secureConnectionStart: number;
  readonly requestStart: number;
  readonly responseStart: number;
  readonly responseEnd: number;
  readonly transferSize: number;
  readonly encodedBodySize: number;
  readonly decodedBodySize: number;
}
declare var PerformanceResourceTiming: { prototype: PerformanceResourceTiming; new (): PerformanceResourceTiming };
interface PerformanceObserverEntryList {
  getEntries(): PerformanceEntry[];
  getEntriesByType(type: string): PerformanceEntry[];
  getEntriesByName(name: string, type?: string): PerformanceEntry[];
}
declare var PerformanceObserverEntryList: {
  prototype: PerformanceObserverEntryList;
  new (): PerformanceObserverEntryList;
};
interface PerformanceObserverInit {
  entryTypes?: string[];
  type?: string;
  buffered?: boolean;
}
interface PerformanceObserver {
  observe(options?: PerformanceObserverInit): void;
  disconnect(): void;
  takeRecords(): PerformanceEntry[];
}
declare var PerformanceObserver: {
  prototype: PerformanceObserver;
  new (callback: (list: PerformanceObserverEntryList, observer: PerformanceObserver) => void): PerformanceObserver;
  readonly supportedEntryTypes: readonly string[];
};
interface Performance extends EventTarget {
  readonly timeOrigin: number;
  now(): number;
  toJSON(): object;
  getEntries(): PerformanceEntry[];
  getEntriesByType(type: string): PerformanceEntry[];
  getEntriesByName(name: string, type?: string): PerformanceEntry[];
  clearResourceTimings(): void;
  setResourceTimingBufferSize(maxSize: number): void;
  mark(name: string, options?: { detail?: unknown; startTime?: number }): PerformanceMark;
  clearMarks(name?: string): void;
  measure(name: string, startOrOptions?: string | object, endMark?: string): PerformanceMeasure;
  clearMeasures(name?: string): void;
}
declare var Performance: { prototype: Performance; new (): Performance };

// src/runtime/api/bun/subprocess.rs, subprocess.bind.ts: what `Bun.spawn` answers.
declare namespace $Bindgen {
  interface Subprocess {
    readonly pid: number;
    /** By the `stdio` option: a sink for "pipe", a file descriptor, or nothing. */
    readonly stdin: $Node.FileSink | number | undefined | null;
    readonly stdout: ReadableStream<Uint8Array> | number | undefined | null;
    readonly stderr: ReadableStream<Uint8Array> | number | undefined | null;
    /** The parent's end of each descriptor from 3 on; `null` for the first three and for what is not a pipe. */
    readonly stdio: (number | null)[];
    readonly connected: boolean;
    /** True once the process has exited or a signal has ended it. */
    readonly killed: boolean;
    readonly exitCode: number | null;
    readonly signalCode: string | null;
    readonly exited: Promise<number>;
    kill(signal?: number | string): void;
    send(message: unknown, handle?: unknown, options?: object, callback?: (error: Error | null) => void): boolean;
    disconnect(): void;
    ref(): void;
    unref(): void;
  }
}

// src/jsc/bindings/webcore/JSWorker.cpp
interface Worker extends EventTarget {
  readonly threadId: number;
  postMessage(message: unknown, transfer?: Iterable<object> | { transfer?: Iterable<object> }): void;
  terminate(): void;
  ref(): void;
  unref(): void;
  // For `node:worker_threads`.
  getHeapSnapshot(options: unknown): Promise<string>;
  getHeapStatistics(): Promise<Record<string, number | boolean>>;
  startCpuProfileInternal(): Promise<void>;
  stopCpuProfileInternal(): Promise<string>;
  cpuUsageInternal(): Promise<{ user: number; system: number }>;
}

// node:crypto. src/jsc/bindings/node/crypto/*.cpp (JSSign, JSVerify, JSHash, JSHmac, JSCipher ..)
declare namespace $Node {
  type CryptoData = string | AnyView;

  interface NativeSign {
    init(algorithm: string): void;
    /** Answers `self`. */
    update<T>(self: T, data: CryptoData, encoding?: string): T;
    sign(options: unknown, encoding?: string): Buffer | string;
  }
  interface NativeVerify {
    init(algorithm: string): void;
    update<T>(self: T, data: CryptoData, encoding?: string): T;
    verify(options: unknown, signature: CryptoData, signatureEncoding?: string): boolean;
  }
  interface NativeHash {
    /** `throwIfFinalized` false: a chunk that comes after `digest()` is dropped, and the answer is `undefined`. */
    update<T>(self: T, data: CryptoData, encoding?: string): T;
    update<T>(self: T, data: CryptoData, encoding: string | undefined, throwIfFinalized: false): T | undefined;
    digest(outputEncoding?: string | null, finalize?: boolean): Buffer | string;
  }
  interface NativeHmac {
    update<T>(self: T, data: CryptoData, encoding?: string): T;
    update<T>(self: T, data: CryptoData, encoding: string | undefined, throwIfFinalized: false): T | undefined;
    digest(outputEncoding?: string | null): Buffer | string;
  }
  interface NativeCipher {
    update(data: CryptoData, inputEncoding?: string): Buffer;
    final(): Buffer;
    setAutoPadding(autoPadding?: boolean): void;
    getAuthTag(): Buffer;
    setAuthTag(tag: CryptoData, encoding?: string): void;
    setAAD(data: CryptoData, options?: { plaintextLength?: number; encoding?: string }): void;
  }
}

// The native handles of `node:quic`: src/runtime/node/quic/quic.bind.ts, endpoint.rs, session.rs, stream.rs
declare namespace $Bindgen {
  interface QuicTransportParams {
    preferredAddressIpv4?: object;
    preferredAddressIpv6?: object;
  }
  interface QuicEndpoint {
    /** With `state`: memory that the native side writes. */
    readonly stats: ArrayBuffer;
    readonly state: ArrayBuffer;
    listen(options: object): void;
    /** `undefined`: the endpoint is closed. */
    connect(address: object, options: object, sessionTicket?: ArrayBufferView): QuicSession | undefined;
    closeGracefully(): void;
    releaseSocket(): void;
    markBusy(busy: boolean): void;
    setSNIContexts(entries: object, replace: boolean): void;
    address(): object | undefined;
  }
  interface QuicSession {
    readonly stats: ArrayBuffer;
    readonly statsByteOffset: number;
    readonly state: ArrayBuffer;
    readonly stateByteOffset: number;
    destroy(options?: object): void;
    gracefulClose(options?: object): void;
    getRemoteAddress(): object | undefined;
    getLocalAddress(): object | undefined;
    /** DER bytes. */
    getCertificate(): Uint8Array | undefined;
    getPeerCertificate(): Uint8Array | undefined;
    getEphemeralKey(): object | undefined;
    updateKey(): boolean;
    /** `undefined`: the session is closed. */
    openStream(direction: number, body?: unknown): QuicStream | undefined;
    /** The id of the datagram, `0n` if it was not sent. */
    sendDatagram(data: ArrayBufferView): bigint;
    localTransportParams(): QuicTransportParams | undefined;
    remoteTransportParams(): QuicTransportParams | undefined;
    applicationOptions(): object;
  }
  interface QuicStream {
    readonly stats: ArrayBuffer;
    readonly statsByteOffset: number;
    readonly state: ArrayBuffer;
    readonly stateByteOffset: number;
    attachSource(source: unknown): void;
    destroy(error?: unknown): void;
    sendHeaders(kind: number, headers: unknown, flags: number): boolean;
    stopSending(code: bigint | number): void;
    resetStream(code: bigint | number): void;
    abortForDestroy(stopCode: bigint | number | undefined, resetCode: bigint | number | undefined): void;
    setPriority(packed: number): void;
    getPriority(): number;
    /** The stream itself. */
    getReader(): QuicStream;
    setWakeup(wakeup: ((value?: unknown) => void) | undefined): void;
    pull(callback: (status: number, buffer: ArrayBuffer | undefined) => void): void;
    initStreamingSource(): void;
    /** The number of bytes queued; `undefined`: the stream is closed. */
    write(chunks: Uint8Array[]): number | undefined;
    endWrite(): void;
  }
}

declare namespace $Node {
  // src/runtime/node/node_quic_binding.rs
  interface QuicBinding {
    Endpoint: new (options: object) => $Bindgen.QuicEndpoint;
    /** `onEndpointClose`, `onSessionClose` ..: called with the native handle as `this`. */
    setCallbacks(callbacks: object): void;
    CC_ALGO_RENO_STR: string;
    CC_ALGO_CUBIC_STR: string;
    CC_ALGO_BBR_STR: string;
    DEFAULT_CIPHERS: string;
    DEFAULT_GROUPS: string;
    DEFAULT_PREFERRED_ADDRESS_POLICY: number;
    [index: `IDX_${string}`]: number;
    [context: `CLOSECONTEXT_${string}`]: number;
    [policy: `PREFERRED_ADDRESS_${string}`]: number;
    [direction: `STREAM_DIRECTION_${string}`]: number;
    [headers: `QUIC_STREAM_HEADERS_${string}`]: number;
  }
}

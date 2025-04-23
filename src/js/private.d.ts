// The types in this file are not publicly defined, but do exist.
// Stuff like `Bun.fs()` and so on.

type BunFSWatchOptions = { encoding?: BufferEncoding; persistent?: boolean; recursive?: boolean; signal?: AbortSignal };
type BunWatchEventType = "rename" | "change" | "error" | "close";
type BunWatchListener<T> = (event: WatchEventType, filename: T | undefined) => void;

/**
 * If this is not tree-shaken away, the bundle will fail.
 */
declare function $bundleError(...message: any[]): never;

interface BunFSWatcher {
  /**
   * Stop watching for changes on the given `BunFSWatcher`. Once stopped, the `BunFSWatcher` object is no longer usable.
   * @since v0.6.8
   */
  close(): void;

  /**
   * When called, requests that the Node.js event loop not exit so long as the <BunFSWatcher> is active. Calling watcher.ref() multiple times will have no effect.
   */
  ref(): void;

  /**
   * When called, the active <BunFSWatcher> object will not require the Node.js event loop to remain active. If there is no other activity keeping the event loop running, the process may exit before the <BunFSWatcher> object's callback is invoked. Calling watcher.unref() multiple times will have no effect.
   */
  unref(): void;
}
type BunFS = Omit<typeof import("node:fs") & typeof import("node:fs/promises"), "watch" | "cp" | "cpSync"> & {
  /**
   * Watch for changes on `filename`, where `filename` is either a file or a
   * directory.
   *
   * The second argument is optional. If `options` is provided as a string, it
   * specifies the `encoding`. Otherwise `options` should be passed as an object.
   *
   * The listener callback gets two arguments `(eventType, filename)`. `eventType`is either `'rename'`, `'change', 'error' or 'close'`, and `filename` is the name of the file
   * which triggered the event, the error when `eventType` is 'error' or undefined when eventType is 'close'.
   *
   * On most platforms, `'rename'` is emitted whenever a filename appears or
   * disappears in the directory.
   *
   *
   * If a `signal` is passed, aborting the corresponding AbortController will close
   * the returned `BunFSWatcher`.
   * @since v0.6.8
   * @param listener
   */
  watch(
    filename: string,
    options:
      | (WatchOptions & {
          encoding: "buffer";
        })
      | "buffer",
    listener?: BunWatchListener<Buffer>,
  ): BunFSWatcher;
  /**
   * Watch for changes on `filename`, where `filename` is either a file or a directory, returning an `BunFSWatcher`.
   * @param filename A path to a file or directory. If a URL is provided, it must use the `file:` protocol.
   * @param options Either the encoding for the filename provided to the listener, or an object optionally specifying encoding, persistent, and recursive options.
   * If `encoding` is not supplied, the default of `'utf8'` is used.
   * If `persistent` is not supplied, the default of `true` is used.
   * If `recursive` is not supplied, the default of `false` is used.
   */
  watch(
    filename: string,
    options?: WatchOptions | BufferEncoding | null,
    listener?: BunWatchListener<string>,
  ): BunFSWatcher;
  /**
   * Watch for changes on `filename`, where `filename` is either a file or a directory, returning an `BunFSWatcher`.
   * @param filename A path to a file or directory. If a URL is provided, it must use the `file:` protocol.
   * @param options Either the encoding for the filename provided to the listener, or an object optionally specifying encoding, persistent, and recursive options.
   * If `encoding` is not supplied, the default of `'utf8'` is used.
   * If `persistent` is not supplied, the default of `true` is used.
   * If `recursive` is not supplied, the default of `false` is used.
   */
  watch(
    filename: string,
    options: BunWatchListener | string,
    listener?: BunWatchListener<string | Buffer>,
  ): BunFSWatcher;
  /**
   * Watch for changes on `filename`, where `filename` is either a file or a directory, returning an `BunFSWatcher`.
   * @param filename A path to a file or directory. If a URL is provided, it must use the `file:` protocol.
   */
  watch(filename: string, listener?: BunWatchListener<string>): BunFSWatcher;

  // internal api is for fs.cp and fs.cpSync that is limited to a few options.
  // there is a js implementation for options like `filter` in `src/js/internal/fs/cp*`
  cpSync(
    source: string,
    dest: string,
    recursive?: boolean,
    errorOnExist?: boolean,
    force?: boolean,
    mode?: number,
  ): void;
  cp(source: string, dest: string, recursive?: boolean, errorOnExist?: boolean, force?: boolean, mode?: number): void;
};

declare module "bun" {
  var TOML: {
    parse(contents: string): any;
  };
  function jest(path: string): typeof import("bun:test");
  var main: string;
  var tty: Array<{ hasColors: boolean }>;
  var FFI: any;
  /** This version of fetch is untamperable */
  var fetch: typeof globalThis.fetch;

  type DigestEncoding = "hex" | "base64" | "base64url" | "latin1" | "binary";

  interface CryptoHasher {
    hash(
      algorithm: string,
      data: string | ArrayBuffer | ArrayBufferView,
      encoding?: DigestEncoding | BufferEncoding | TypedArray,
    ): Buffer | string | TypedArray;
  }

  var CryptoHasher: {
    hash(
      algorithm: string,
      data: string | ArrayBuffer | ArrayBufferView,
      encoding?: DigestEncoding | BufferEncoding | TypedArray,
    ): Buffer | string | TypedArray;
  };

  interface SpawnOptions {
    cmd: string[];
    stdio?: Array<string | number | null | NodeJS.TypedArray | ArrayBufferView>;
    cwd?: string;
    env?: Record<string, string>;
    detached?: boolean;
    onExit?: (handle: any, exitCode: number, signalCode: string | null, err: Error | null) => void;
    lazy?: boolean;
    ipc?: ((message: any) => void) | undefined;
    onDisconnect?: ((ok: boolean) => void) | undefined;
    serialization?: string;
    argv0?: string;
    windowsHide?: boolean;
    windowsVerbatimArguments?: boolean;
  }

  interface SpawnHandle {
    pid: number;
    stdin?: any;
    stdout?: any;
    stderr?: any;
    stdio?: any[];
    killed?: boolean;
    connected?: boolean;
    kill(signal?: string | number): boolean;
    ref(): void;
    unref(): void;
    disconnect(): void;
    send(message: any): boolean;
  }

  function spawn(options: SpawnOptions): SpawnHandle;

  interface UDPSocketOptions {
    hostname: string;
    port: number;
    flags?: number;
    socket: {
      data: (socket: any, data: Buffer, port: number, address: string) => void;
      error: (error: Error) => void;
    };
  }

  function udpSocket(options: UDPSocketOptions): Promise<any>;

  interface DNSResolverOptions {
    timeout?: number;
    tries?: number;
    family?: number;
    hints?: number;
    verbatim?: boolean;
    all?: boolean;
    addrconfig?: boolean;
    v4mapped?: boolean;
    ttl?: boolean;
    servers?: string[];
    resultOrder?: string;
    [key: string]: any;
  }

  interface DNSResolver {
    getServers(): string[];
    setServers(servers: string[]): void;
    resolve(hostname: string, rrtype?: string): Promise<any[]>;
    resolve4(hostname: string, options?: { ttl?: boolean }): Promise<any[]>;
    resolve6(hostname: string, options?: { ttl?: boolean }): Promise<any[]>;
    resolveAny(hostname: string): Promise<any[]>;
    resolveCname(hostname: string): Promise<string[]>;
    resolveMx(hostname: string): Promise<{ priority: number; exchange: string }[]>;
    resolveNs(hostname: string): Promise<string[]>;
    resolveTxt(hostname: string): Promise<string[][]>;
    resolveSrv(hostname: string): Promise<{ priority: number; weight: number; port: number; name: string }[]>;
    resolvePtr(hostname: string): Promise<string[]>;
    resolveNaptr(hostname: string): Promise<any[]>;
    resolveSoa(hostname: string): Promise<any>;
    reverse(ip: string): Promise<string[]>;
    lookup(hostname: string, options?: DNSResolverOptions): Promise<any>;
    lookupService(address: string, port: string | number): Promise<{ hostname: string; service: string }>;
    _handle?: any;
  }

  var dns: DNSResolver;
}

// Constants for EventEmitter
declare const kCapture: unique symbol;
declare const kErrorMonitor: unique symbol;
declare const kMaxEventTargetListeners: unique symbol;
declare const kMaxEventTargetListenersWarned: unique symbol;
declare const kWatermarkData: unique symbol;
declare const kRejection: unique symbol;
declare const kFirstEventParam: unique symbol;

// Base EventEmitter interface
interface EventEmitter {
  // We use non-optional _events to avoid TypeScript undefined warnings
  _events: {
    [key: string]: any;
    [key: symbol]: any;
    __proto__: null;
    newListener?: any;
    removeListener?: any;
  };
  _eventsCount: number;
  _maxListeners?: number;
  [kCapture]?: boolean;
  [kRejection]?: Function;

  emit(type: string, ...args: any[]): boolean;
  on(type: string, listener: Function): this;
  once(type: string, listener: Function): this;
  off(type: string, listener: Function): this;
  addListener(type: string, listener: Function): this;
  removeListener(type: string, listener: Function): this;
  prependListener(type: string, listener: Function): this;
  prependOnceListener(type: string, listener: Function): this;
  removeAllListeners(type?: string | symbol): this;
  setMaxListeners(n: number): this;
  getMaxListeners(): number;
  listeners(type: string): Function[];
  rawListeners(type: string): Function[];
  listenerCount(type: string, listener?: Function): number;
  eventNames(): (string | symbol)[];
  pause?(): void;
  resume?(): void;
}

// DOM-like event target interface
interface JSEventTarget {
  addEventListener(type: string, listener: Function, options?: any): void;
  removeEventListener(type: string, listener: Function, options?: any): void;
}

// Event options interface to use with empty objects
interface EventOptions {
  signal?: AbortSignal;
}

// Options for event stream
interface EventStreamOptions {
  signal?: AbortSignal;
  highWaterMark?: number;
  highWatermark?: number; // Alternative spelling
  lowWaterMark?: number;
  lowWatermark?: number; // Alternative spelling
  close?: string[];
  [kFirstEventParam]?: boolean;
}

// Wrapper for once listener
interface WrappedListener extends Function {
  listener: Function;
}

// Interface for error with additional properties for listener warnings
interface MaxListenersWarning extends Error {
  emitter: any;
  type: string;
  count: number;
}

interface FixedQueue {
  isEmpty(): boolean;
  shift(): any;
  push(item: any): void;
}

interface AbortSignal {
  aborted: boolean;
  reason?: any;
  addEventListener(type: string, listener: Function, options?: any): void;
  removeEventListener(type: string, listener: Function, options?: any): void;
}

// AsyncResource from async_hooks
interface AsyncResourceConstructor {
  new (name: string, options?: { triggerAsyncId?: number; requireManualDestroy?: boolean }): AsyncResource;
}

interface AsyncResource {
  runInAsyncScope(fn: Function, thisArg?: any, ...args: any[]): any;
  emitDestroy(): void;
}

// Common empty object used in the Node.js implementation
declare const kEmptyObject: Readonly<{ __proto__: null }>;

// Error constructor helpers for node errors
declare function $ERR_INVALID_ARG_TYPE(name: string, expected: string | string[], actual: any): Error;

// Add to global Function interface to support the listener property
interface Function {
  listener?: Function;
}

// Watcher handle for fs.watchFile
interface StatWatcherHandle {
  ref(): void;
  unref(): void;
  close(): void;
}

// File system types
interface Stats {
  dev: number;
  ino: number;
  mode: number;
  nlink: number;
  uid: number;
  gid: number;
  rdev: number;
  size: number;
  blksize: number;
  blocks: number;
  atimeMs: number;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
  atime: Date;
  mtime: Date;
  ctime: Date;
  birthtime: Date;
  isFile(): boolean;
  isDirectory(): boolean;
  isBlockDevice(): boolean;
  isCharacterDevice(): boolean;
  isSymbolicLink(): boolean;
  isFIFO(): boolean;
  isSocket(): boolean;
}

interface Dirent {
  name: string;
  parentPath?: string;
  path?: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isBlockDevice(): boolean;
  isCharacterDevice(): boolean;
  isSymbolicLink(): boolean;
  isFIFO(): boolean;
  isSocket(): boolean;
}

/**
 * `JSC::JSModuleLoader`
 */
declare var Loader: {
  registry: Map<string, LoaderEntry>;

  parseModule(key: string, sourceCodeObject: JSCSourceCodeObject): Promise<LoaderModule> | LoaderModule;
  linkAndEvaluateModule(resolvedSpecifier: string, unknown: any);
  getModuleNamespaceObject(module: LoaderModule): any;
  requestedModules(module: LoaderModule): string[];
  dependencyKeysIfEvaluated(specifier: string): string[];
  resolve(specifier: string, referrer: string): string;
  ensureRegistered(key: string): LoaderEntry;
};

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
  context?: any;
}

declare function $ERR_UNHANDLED_ERROR(stringifiedErr: any): Error;
declare function $makeAbortError(message?: string, options?: { cause?: any }): Error;
declare function $isPromise(value: any): boolean;
declare function $newPromiseCapability(Promise: PromiseConstructor): {
  resolve: Function;
  reject: Function;
  promise: Promise<any>;
};

interface JSCommonJSModule {
  $require(id: string, mod: any, args_count: number, args: Array): any;
  $requireNativeModule(id: string): any;
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
 * Binding files are located in `src/bun.js/bindings`
 *
 * @see {@link $zig} for native zig bindings.
 * @see `src/codegen/replacements.ts` for the script that performs replacement of this funciton.
 *
 * @param filename name of the c++ file containing the function. Do not pass a path.
 * @param symbol   The name of the binding function to call. Use `dot.notation` to access
 *                 member symbols.
 *
 * @returns whatever the binding function returns.
 */
declare function $cpp<T = any>(filename: NativeFilenameCPP, symbol: string): T;
/**
 * Call a native zig binding function, getting whatever it returns.
 *
 * This is more like a macro; it is replaced with a WebKit intrisic during
 * codegen. Passing a template parameter will break codegen. Prefer `$zig(...)
 * as Foo` instead.
 *
 * Binding files are located in `src/bun.js/bindings`
 *
 * @see {@link $cpp} for native c++ bindings.
 * @see `src/codegen/replacements.ts` for the script that performs replacement of this funciton.
 *
 * @param filename name of the zig file containing the function. Do not pass a path.
 * @param symbol   The name of the binding function. Use `dot.notation` to access
 *                 member symbols.
 *
 * @returns whatever the binding function returns.
 */
declare function $zig<T = any>(filename: NativeFilenameZig, symbol: string): T;
declare function $newCppFunction<T = (...args: any) => any>(
  filename: NativeFilenameCPP,
  symbol: string,
  argCount: number,
): T;
declare function $newZigFunction<T = (...args: any) => any>(
  filename: NativeFilenameZig,
  symbol: string,
  argCount: number,
): T;
/**
 * Retrieves a handle to a function defined in Zig or C++, defined in a
 * `.bind.ts` file. For more information on how to define bindgen functions, see
 * [bindgen's documentation](https://bun.sh/docs/project/bindgen).
 * @param filename - The basename of the `.bind.ts` file.
 * @param symbol - The name of the function to call.
 */
declare function $bindgenFn<T = (...args: any) => any>(filename: string, symbol: string): T;
// NOTE: $debug, $assert, and $isPromiseFulfilled omitted

// DNS module type with all exported properties and methods
interface DNS extends DNSResolver {
  ADDRCONFIG: number;
  V4MAPPED: number;
  ALL: number;
  NODATA: string;
  FORMERR: string;
  SERVFAIL: string;
  NOTFOUND: string;
  NOTIMP: string;
  REFUSED: string;
  BADQUERY: string;
  BADNAME: string;
  BADFAMILY: string;
  BADRESP: string;
  CONNREFUSED: string;
  TIMEOUT: string;
  EOF: string;
  FILE: string;
  NOMEM: string;
  DESTRUCTION: string;
  BADSTR: string;
  BADFLAGS: string;
  NONAME: string;
  BADHINTS: string;
  NOTINITIALIZED: string;
  LOADIPHLPAPI: string;
  ADDRGETNETWORKPARAMS: string;
  CANCELLED: string;

  // Adding these to fix TS errors
  reverse(ip: string): Promise<string[]>;
}

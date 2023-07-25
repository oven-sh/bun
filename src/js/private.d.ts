// The types in this file are not publicly defined, but do exist.
// Stuff like `Bun.fs()` and so on.

/**
 * Works like the zig `@compileError` built-in, but only supports plain strings.
 */
declare function $bundleError(error: string);

type BunFSWatchOptions = { encoding?: BufferEncoding; persistent?: boolean; recursive?: boolean; signal?: AbortSignal };
type BunWatchEventType = "rename" | "change" | "error" | "close";
type BunWatchListener<T> = (event: WatchEventType, filename: T | undefined) => void;

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
type BunFS = Omit<typeof import("node:fs"), "watch"> & {
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
};

declare module "bun" {
  var TOML: {
    parse(contents: string): any;
  };
  function fs(): BunFS;
  function _Os(): typeof import("node:os");
  function _Path(isWin32?: boolean): typeof import("node:path");
  function jest(): typeof import("bun:test");
  var main: string;
  var tty: Array<{ hasColors: boolean }>;
  var FFI: any;
  /** This version of fetch is untamperable */
  var fetch: typeof globalThis.fetch;
}

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
}

interface LoaderModule {
  dependenciesMap: Map<string, LoaderEntry>;
}

declare interface Error {
  code?: string;
}

/**
 * Load an internal native module. To see implementation details, open ZigGlobalObject.cpp and cmd+f `static JSC_DEFINE_HOST_FUNCTION(functionLazyLoad`
 *
 * This is only valid in src/js/ as it is replaced with `globalThis[Symbol.for("Bun.lazy")]` at bundle time.
 */
function $lazy<T extends keyof BunLazyModules>(id: T): BunLazyModules[T];

interface BunLazyModules {
  /**
   * Primordials is a dynamic object that contains builtin functions and values.
   *
   * like primordials.isPromise -> $isPromise, etc
   * Also primordials.Bun -> $Bun, etc; untampered globals
   *
   * The implmentation of this is done using createBuiltin('(function (){ return @<name here>; })')
   * Meaning you can crash bun if you try returning something like `getInternalField`
   */
  primordials: any;

  "bun:jsc": Omit<typeof import("bun:jsc"), "jscDescribe" | "jscDescribeArray"> & {
    describe: typeof import("bun:jsc").jscDescribe;
    describeArray: typeof import("bun:jsc").jscDescribe;
  };
  "bun:stream": {
    maybeReadMore: Function;
    resume: Function;
    emitReadable: Function;
    onEofChunk: Function;
    ReadableState: Function;
  };
  sqlite: any;
  "vm": {
    createContext: Function;
    isContext: Function;
    Script: typeof import("node:vm").Script;
    runInNewContext: Function;
    runInThisContext: Function;
  };
  /** typeof === 'undefined', but callable -> throws not implemented */
  "masqueradesAsUndefined": (...args: any) => any;
  pathToFileURL: typeof import("node:url").pathToFileURL;
  fileURLToPath: typeof import("node:url").fileURLToPath;
  noop: {
    getterSetter: any;
    function: any;
    functionRegular: any;
    callback: any;
  };
  "async_hooks": {
    get: typeof import("./builtins/AsyncContext").getAsyncContext;
    set: typeof import("./builtins/AsyncContext").setAsyncContext;
    cleanupLater: () => void;
  };

  // ReadableStream related
  [1]: any;
  [2]: any;
  [4]: any;
}

/** Assign to this variable in src/js/{bun,node,thirdparty} to act as module.exports */
declare var $exports: any;

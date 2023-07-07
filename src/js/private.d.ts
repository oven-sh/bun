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
  function jest(): typeof import("bun:test");
  var main: string;
  var tty: Array<{ hasColors: boolean }>;
  var FFI: any;
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

declare interface ImportMeta {
  primordials: {};
}

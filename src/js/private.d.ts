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

    /**
     * Represents the result of the `parseOptions()` function in the sqlite path
     */
    type DefinedSQLiteOptions = Define<Bun.SQL.SQLiteOptions, "filename">;

    /**
     * Represents the result of the `parseOptions()` function in the postgres, mysql or mariadb path
     */
    type DefinedPostgresOrMySQLOptions = Define<Bun.SQL.PostgresOrMySQLOptions, "max" | "prepare" | "max"> & {
      sslMode: import("internal/sql/shared").SSLMode;
      query: string;
    };

    type DefinedOptions = DefinedSQLiteOptions | DefinedPostgresOrMySQLOptions;
    type OptionsWithDefinedAdapter = Define<Bun.SQL.Options, "adapter">;
  }
}

declare module "bun" {
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
      websocket: WebSocketHandler<WebSocketData>;
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
    interface NodeSpawnOptions
      extends Omit<
        Bun.Spawn.SpawnOptions<Bun.SpawnOptions.Writable, Bun.SpawnOptions.Readable, Bun.SpawnOptions.Readable>,
        "stdio" | "onDisconnect"
      > {
      cmd: string[];
      stdio: NodeStdio;
      onDisconnect?(ok: boolean): void;
    }
    interface NodeSpawnSyncOptions
      extends Omit<
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

declare namespace NodeJS {
  interface Process {
    /** The `-e` / `--eval` source, which `node:child_process` reads when it forks the current script. */
    _eval?: string;
    /** Set by `node:domain` while a domain is active. */
    domain?: import("node:domain").Domain | null;
  }
}

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

/** A CommonJS require cache: resolved path -> module. */
type RequireMap = Map<string, JSCommonJSModule>;

interface JSCommonJSModule {
  /** The require cache the module reads and writes: the global one, or its Bun.ModuleGraph's. */
  readonly $requireMap: RequireMap;
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
 * Binding files are located in `src/jsc/bindings`
 *
 * @see {@link $rust} for native Rust bindings.
 * @see `src/codegen/replacements.ts` for the script that performs replacement of this function.
 *
 * @param filename name of the c++ file containing the function. Do not pass a path.
 * @param symbol   The name of the binding function to call. Use `dot.notation` to access
 *                 member symbols.
 *
 * @returns whatever the binding function returns.
 */
declare function $cpp<T = any>(filename: NativeFilenameCPP, symbol: string): T;
/**
 * Call a native Rust binding function, getting whatever it returns.
 *
 * This is more like a macro; it is replaced with a WebKit intrisic during
 * codegen. Passing a template parameter will break codegen. Prefer `$rust(...)
 * as Foo` instead.
 *
 * @see {@link $cpp} for native c++ bindings.
 * @see `src/codegen/replacements.ts` for the script that performs replacement of this function.
 *
 * @param filename identifier of the Rust module containing the function (see
 *                 `rustIdentifierPaths` in `src/codegen/generate-js2native.ts`).
 * @param symbol   The name of the binding function. Use `dot.notation` to access
 *                 member symbols.
 *
 * @returns whatever the binding function returns.
 */
declare function $rust<T = any>(filename: NativeFilenameRust, symbol: string): T;
declare function $newCppFunction<T = (...args: any) => any>(
  filename: NativeFilenameCPP,
  symbol: string,
  argCount: number,
): T;
declare function $newRustFunction<T = (...args: any) => any>(
  filename: NativeFilenameRust,
  symbol: string,
  argCount: number,
): T;
/**
 * Retrieves a handle to a function defined in native code, defined in a
 * `.bind.ts` file. For more information on how to define bindgen functions, see
 * [bindgen's documentation](https://bun.com/docs/project/bindgen).
 * @param filename - The basename of the `.bind.ts` file.
 * @param symbol - The name of the function to call.
 */
declare function $bindgenFn<T = (...args: any) => any>(filename: string, symbol: string): T;
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

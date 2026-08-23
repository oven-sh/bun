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
}

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

interface JSCommonJSModule {
  $require(id: string, mod: any, args_count: number, args: Array): any;
  /** Loads the builtin a resolved `node:` id names, or `undefined` for a virtual module. */
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
 * Call a native Rust binding function, getting whatever it returns.
 *
 * This is more like a macro; it is replaced with a WebKit intrisic during
 * codegen. Passing a template parameter will break codegen. Prefer `$rust(...)
 * as Foo` instead.
 *
 * @see {@link $cpp} for native c++ bindings.
 * @see `src/codegen/replacements.ts` for the script that performs replacement of this funciton.
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

declare module "node:net" {
  function _normalizeArgs(options: any[]): [Record<PropertyKey, any>, Function | null];

  interface Socket {
    _handle: Bun.Socket<{ self: Socket; req?: object }> | null;
    server: Server | null;
  }

  interface Server {
    _handle: Bun.SocketListener<Socket> | null;
    _connections: number;
  }
}

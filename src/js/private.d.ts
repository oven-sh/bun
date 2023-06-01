// The types in this file are not publicly defined, but do exist.
// Stuff like `Bun.fs()` and so on.

/**
 * Works like the zig `@compileError` built-in, but only supports plain strings.
 */
declare function $bundleError(error: string);

declare module "bun" {
  var TOML: {
    parse(contents: string): any;
  };
  function fs(): typeof import("node:fs");
  function _Os(): typeof import("node:os");
  function jest(): typeof import("bun:test");
  var main: string;
  var tty: Array<{ hasColors: boolean }>;
  var FFI: any;
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

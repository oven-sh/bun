declare module "node:module" {
  export * from "module";
}

declare module "module" {
  export function createRequire(filename: string): NodeJS.Require;
  export function _resolveFileName(
    path: string,
    parent: string,
    isMain: boolean,
  ): string;
  /**
   * Bun's module cache is not exposed but this property exists for compatibility.
   */
  export var _cache: {};

  export var builtinModules: string[];
}

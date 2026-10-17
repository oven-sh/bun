declare namespace contexts {
  interface ContextOptions {
    name?: string | undefined;
    codeGeneration?: { strings?: boolean | undefined; wasm?: boolean | undefined } | undefined;
    importModuleDynamically?: (() => never) | undefined;
  }
  function createContext(sandbox: Record<string, unknown>, options?: ContextOptions): number;
}

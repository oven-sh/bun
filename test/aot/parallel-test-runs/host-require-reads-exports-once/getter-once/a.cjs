globalThis.leaf = module;
globalThis.reads = 0;
Object.defineProperty(module, "exports", { get() { globalThis.reads++; return { name: "a" }; }, configurable: true });

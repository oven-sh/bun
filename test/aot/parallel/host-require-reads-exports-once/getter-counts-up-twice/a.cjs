globalThis.leaf = module;
globalThis.reads = 0;
Object.defineProperty(module, "exports", { get() { return { read: ++globalThis.reads }; }, configurable: true });

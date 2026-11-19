globalThis.leaf = module;
globalThis.reads = 0;
Object.defineProperty(module, "exports", { get() { if (++globalThis.reads > 1) throw new Error("second read"); return { name: "a" }; }, configurable: true });

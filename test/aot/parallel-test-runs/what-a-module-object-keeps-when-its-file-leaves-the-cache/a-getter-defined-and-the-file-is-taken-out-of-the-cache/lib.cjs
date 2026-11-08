exports.a = 1;
globalThis.kept = module;
Object.defineProperty(module, "exports", { get() { return "got"; }, configurable: true });

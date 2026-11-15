globalThis.leaf = module;
globalThis.reads = 0; globalThis.writes = 0;
let held = { name: "a" };
Object.defineProperty(module, "exports", { get() { globalThis.reads++; return held; }, set(v) { globalThis.writes++; held = v; }, configurable: true });
module.exports = { name: "b" };

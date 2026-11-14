globalThis.leaf = module;
globalThis.reads = 0;
const proto = Object.create(Object.getPrototypeOf(module), { exports: { get() { globalThis.reads++; return { name: "proto" }; }, configurable: true } });
delete module.exports;
Object.setPrototypeOf(module, proto);

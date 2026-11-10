// The key is a registered symbol, so the read and the definition name no built-in member of the global object.
const kEmitter = Symbol.for("signal-exit emitter");
const g = globalThis;
if (!g[kEmitter]) Object.defineProperty(g, kEmitter, { value: { n: 1 }, writable: false });
console.log(g[kEmitter].n);

// Two calls of import(), one behind the other, each under a store of AsyncLocalStorage of its own. The first module imports a CommonJS file that calls drainMicrotasks() of bun:jsc before it exports a name. The second module takes that name, so its load waits for the end of the file. Each module reads the store of its own call.
const { AsyncLocalStorage } = require("node:async_hooks");
const store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
store.run("first", () => import("./first.mjs"));
store.run("second", () => import("./second.mjs"));

// An import() under a store of AsyncLocalStorage loads a graph. A CommonJS file of that graph calls require() of an ES module under another store, and the two graphs share modules that are not loaded yet. The synchronous load runs inside the call of require(): every module that runs there reads the store of the caller.
const { AsyncLocalStorage } = require("node:async_hooks");
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
store.run("import", () => import("./imports-shared.mjs")).then(() => see("behind the import()"));
see("main");

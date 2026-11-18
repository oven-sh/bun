// An import() under a store of AsyncLocalStorage. One module of the graph enters another store, and the next one has a top-level await. The module that waits for the await runs in a later job, which continues the job that began the awaiting module: it reads the store that the first module entered.
const { AsyncLocalStorage } = require("node:async_hooks");
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
store.run("import", () => import("./waits.mjs")).then(() => see("behind the import()"));
see("main");

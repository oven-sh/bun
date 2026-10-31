// require() of an ES module under a store of AsyncLocalStorage. The module calls import() under another store, and the graph of that import() has a top-level await. The synchronous load begins that graph inside the call of require(), in the context of the caller. The module that waits for the await runs later, in a job of the import(): under the store of the import().
const { AsyncLocalStorage } = require("node:async_hooks");
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
store.run("require", () => {
  require("./calls-import.mjs");
  see("behind require()");
});
see("main");

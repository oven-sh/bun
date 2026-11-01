// require() of an ES module under a store of AsyncLocalStorage. The module calls import() under another store. The synchronous load also runs the jobs of that import(), inside the call of require(): what the import() loads reads the store of the caller of require().
const { AsyncLocalStorage } = require("node:async_hooks");
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
store.run("require", () => {
  require("./calls-import.mjs");
  see("behind require()");
});
see("main");

// require() of an ES module under a store of AsyncLocalStorage. The module imports a CommonJS file that enters another store. A synchronous load runs inside the call: the modules behind the file and the caller of require() read the store that the file entered.
const { AsyncLocalStorage } = require("node:async_hooks");
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
store.run("call", () => {
  const { name } = require("./imports-enters.mjs");
  see("behind require() of " + name);
});
see("behind run()");
store.run("second call", () => {
  require("./imports-reads.mjs");
  see("behind the second require()");
});
see("main");

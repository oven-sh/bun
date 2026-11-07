const { AsyncLocalStorage } = require("node:async_hooks");
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
globalThis.first = Promise.withResolvers();
globalThis.second = Promise.withResolvers();
globalThis.requireUnderStore = () =>
  store.run("require", () => {
    require("./settles.mjs");
    see("behind require()");
  });
module.exports = {};

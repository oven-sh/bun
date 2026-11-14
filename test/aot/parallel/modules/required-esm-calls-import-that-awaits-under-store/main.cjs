// require() of an ES module under a store of AsyncLocalStorage. The module calls import() under another store, and the graph of that import() has a top-level await. An import() that is called while a require() loads an ES module is no part of what the require() loads: its graph runs after the require() has returned, under the store of the import(), before its await and behind it, as in Node.js.
// `bun run` and `bun build --compile` begin the graph inside the require(), where the module that awaits reads the store of the caller of require().
// docs/compiler/compatibility.mdx, "Loader hooks and the module cache". Plain Bun prints another output.
const { AsyncLocalStorage } = require("node:async_hooks");
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
store.run("require", () => {
  require("./calls-import.mjs");
  see("behind require()");
});
see("main");

/* Output:
calls-import require
behind require() require
main undefined
awaits before its await import
awaits behind its await import
above import
behind the import() require
what above left for later import
*/

// require() of an ES module under a store of AsyncLocalStorage. The module calls import() under another store. An import() that is called while a require() loads an ES module is no part of what the require() loads: what it names runs after the require() has returned, under the store of the import(), as in Node.js.
// `bun run` and `bun build --compile` run it inside the require(), where it reads the store of the caller of require().
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
beside require
calls-import require
end of calls-import require
behind require() require
main undefined
below import
imported import
behind the import() require
*/

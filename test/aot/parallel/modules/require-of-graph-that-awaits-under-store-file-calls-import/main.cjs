// require() of an ES module under a store of AsyncLocalStorage. The module imports a CommonJS file that calls import() under another store, and a module with a top-level await. The load of the require() keeps no store: the module that waits for the await runs later under none, and not under the store of the import() that the file called.
// An import() that is called while a require() loads an ES module is no part of what the require() loads: what it names runs after the require() has returned, under the store of the import(), as in Node.js. `bun run` and `bun build --compile` run it inside the require().
// docs/compiler/compatibility.mdx, "Loader hooks and the module cache". Plain Bun prints another output.
const { AsyncLocalStorage } = require("node:async_hooks");
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
store.run("require", () => {
  try {
    require("./root.mjs");
    see("behind require()");
  } catch (error) {
    see("require() threw for the await: " + error.message.includes("async module"));
  }
});
see("main");

/* Output:
file require
end of file require
awaits before its await require
require() threw for the await: true require
main undefined
other import
behind the import() require
awaits behind its await require
root undefined
*/

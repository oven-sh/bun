// An import() under a store of AsyncLocalStorage loads a graph. A CommonJS file of that graph calls require() of an ES module under another store, and the two graphs share modules that are not loaded yet. The synchronous load runs inside the call of require(): every module that runs there reads the store of the caller.
// `bun <file>` runs below.cjs for the import() where the text of shared.mjs comes before requires.cjs has run: a slow build of Bun prints `below import` in front in two runs of eight. So what the executable prints stands here.
const { AsyncLocalStorage } = require("node:async_hooks");
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
store.run("import", () => import("./imports-shared.mjs")).then(() => see("behind the import()"));
see("main");

/* Output:
main undefined
requires import
below require
shared require
requires-shared require
behind require() require
end of requires import
imports-shared import
behind the import() undefined
*/

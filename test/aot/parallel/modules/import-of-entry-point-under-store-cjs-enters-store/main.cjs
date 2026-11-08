// Entry points: ./second.mjs
// An executable with two entry points. A callback of setImmediate() calls import() of the second one under a store of AsyncLocalStorage, so no other job waits when the import() begins. The module imports two CommonJS files: the first enters another store. Each file runs under the store of the import(), and what the first one enters ends with it.
// `bun <file>` runs the two files in the order in which the threads of its transpiler finish their texts: a slow build of Bun runs reads.cjs first in seven runs of eight. So what the executable prints stands here.
const { AsyncLocalStorage } = require("node:async_hooks");
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
setImmediate(() => {
  store.run("import", () => import("./second.mjs")).then(() => see("behind the import()"));
});
see("main");

/* Output:
main undefined
enters before it enters import
enters entered by enters
reads import
second import
behind the import() undefined
*/

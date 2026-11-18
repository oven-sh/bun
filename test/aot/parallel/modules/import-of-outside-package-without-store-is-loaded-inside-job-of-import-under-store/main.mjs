// A package that is left out of the executable calls import() without a store of AsyncLocalStorage, for files of its own, and those calls are in flight where an import() under a store loads a module that imports a CommonJS file. The file queues a job, so the loader runs the jobs of the other calls inside the job that ran the file: the modules that they evaluate read no store.
// Flags: --external others
// Each call of the package is made one job later than the one before. `bun <file>` evaluates the modules of all four calls in front of the file. The executable runs the file ahead of the loader, and the modules of the third and the fourth call behind it: every line has the store that `bun <file>` prints in it, in another order. So what the executable prints stands here.
import { start } from "others";
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
const withoutStore = [start("first")];
await null;
withoutStore.push(start("second"));
await null;
withoutStore.push(start("third"));
await null;
withoutStore.push(start("fourth"));
await store.run("S", () => import("./stored.mjs"));
await Promise.all(withoutStore);
see("main");

/* Output:
first of the package without a store undefined
second of the package without a store undefined
file S
third of the package without a store undefined
fourth of the package without a store undefined
job of file S
stored S
main undefined
*/

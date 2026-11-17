// A module that an import() under a store of AsyncLocalStorage loads calls drainMicrotasks() of bun:jsc while two more calls are in flight: one without a store, and one whose module imports a CommonJS file that queues a job. The loader runs the jobs of the first inside the job that ran the file, and its module reads the store of whoever called the drain: not that of the other load, and not none.
// The second module does the same where the load with the file keeps the store of the caller of the drain. The call without a store loads text that no file holds, under a name that is put together where the program runs. `bun <file>` has the text of a file only in a later turn, so the modules with a file come behind the drain there: every line has the store that `bun <file>` prints in it, in another order. So what the executable prints stands here.
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
globalThis.outsideOfStores = AsyncLocalStorage.snapshot();
await store.run("S0", () => import("./first.mjs"));
await Promise.all([globalThis.firstWithoutStore, globalThis.firstWithFile]);
await store.run("S0", () => import("./second.mjs"));
await Promise.all([globalThis.secondWithoutStore, globalThis.secondWithFile]);
see("main");

/* Output:
first begins S0
file-1 S2
first without a store S0
job of file-1 S2
with-file-1 S2
first behind the drain S0
second begins S0
file-2 S0
second without a store S0
job of file-2 S0
with-file-2 S0
second behind the drain S0
main undefined
*/

// A module that an import() under a store of AsyncLocalStorage loads calls drainMicrotasks() of bun:jsc while two calls without a store are in flight: one for text that no file holds, and one whose module imports a CommonJS file that queues a job. The drain runs the jobs of both inside the module, and a load that keeps no store enters nothing: all their modules, the file and its job read the store of whoever called the drain.
// `bun <file>` has the text of a file only in a later turn, so it evaluates the module with the file behind the drain, where nothing is in the slot: it prints undefined in the lines of that module, of the file and of its job. In the executable the drain takes that load too. So what the executable prints stands here.
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
globalThis.outsideOfStores = AsyncLocalStorage.snapshot();
await store.run("S0", () => import("./first.mjs"));
await globalThis.withoutFile;
await globalThis.withFile;
see("main");

/* Output:
first begins S0
first outside of stores undefined
file S0
module without a file S0
job of file S0
with-file S0
first behind the drain S0
main undefined
*/

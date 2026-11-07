// import() under a store loads a graph with a cycle. In a later job import() under another store loads a module that imports into that cycle, so the second call waits behind the first load. The modules that only the second graph has read the store of the second call.
// `bun <file>` runs the cycle for the second call where the text of e.mjs comes before the text of a.mjs: a slow build of Bun with twenty runs at once prints that in five runs of 120. So what the executable prints stands here.
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
const first = store.run("first", () => import("./a.mjs"));
await null;
const second = store.run("second", () => import("./e.mjs"));
await Promise.all([first, second]);
see("main");

/* Output:
below-c first
c first
a first
own-e second
own-e behind its await second
e second
main undefined
*/

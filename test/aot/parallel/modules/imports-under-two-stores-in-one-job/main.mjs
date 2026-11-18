// Two import() calls in one job, each under a store of AsyncLocalStorage of its own: two graphs that share a module, then a graph that runs to its end beside a module that awaits. Each module reads the store of the call that loads it.
// `bun <file>` runs the two graphs of a pair in the order in which the threads of its transpiler finish their texts: a slow build of Bun runs ends.mjs in front of awaits.mjs in one run of eight. So what the executable prints stands here.
import { AsyncLocalStorage } from "node:async_hooks";
const store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
await Promise.all([store.run("left", () => import("./left.mjs")), store.run("right", () => import("./right.mjs"))]);
await Promise.all([store.run("ends", () => import("./ends.mjs")), store.run("awaits", () => import("./awaits.mjs"))]);
see("main");

/* Output:
shared left
left left
right right
awaits awaits
awaits behind its await awaits
below-ends ends
ends ends
main undefined
*/

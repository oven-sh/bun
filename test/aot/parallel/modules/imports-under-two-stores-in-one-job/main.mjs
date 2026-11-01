// Two import() calls in one job, each under a store of AsyncLocalStorage of its own: two graphs that share a module, then a graph that runs to its end beside a module that awaits. Each module reads the store of the call that loads it.
import { AsyncLocalStorage } from "node:async_hooks";
const store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
await Promise.all([store.run("left", () => import("./left.mjs")), store.run("right", () => import("./right.mjs"))]);
await Promise.all([store.run("ends", () => import("./ends.mjs")), store.run("awaits", () => import("./awaits.mjs"))]);
see("main");

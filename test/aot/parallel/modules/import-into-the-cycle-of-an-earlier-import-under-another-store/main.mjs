// import() under a store loads a graph with a cycle. In a later job import() under another store loads a module that imports into that cycle, so the second call waits behind the first load. The modules that only the second graph has read the store of the second call.
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
const first = store.run("first", () => import("./a.mjs"));
await null;
const second = store.run("second", () => import("./e.mjs"));
await Promise.all([first, second]);
see("main");

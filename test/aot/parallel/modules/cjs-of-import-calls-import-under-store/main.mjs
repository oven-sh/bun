// import() under a store of AsyncLocalStorage loads a module that imports a CommonJS file by name. While the file runs it calls import() under another store. The modules of each graph read the store of their own call.
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
await store.run("outer", () => import("./outer.mjs"));
await globalThis.inner;
see("main");

// import() under a store of AsyncLocalStorage loads a module that imports a CommonJS file by name, and the file enters another store. The loader of `bun run` runs the file in a job of its own: the file and the job that it queues read the store that it entered, and the modules that run behind it read the store of the call. Once the file queues a job, once it queues none.
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
await store.run("call", () => import("./queues.mjs"));
see("main behind the first call");
await store.run("second call", () => import("./queues-nothing.mjs"));
see("main");

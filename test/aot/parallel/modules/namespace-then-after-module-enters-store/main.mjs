// import() under a store of AsyncLocalStorage loads a module that enters another store and exports then(). The loader asks the namespace for then() under the store of the call, not under what the module entered.
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
console.log("resolved with", await store.run("call", () => import("./enters.mjs")));
see("main behind the first call");
console.log("resolved with", await store.run("second call", () => import("./enters.mjs")));
see("main");

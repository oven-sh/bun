// A CommonJS file of a graph that import() loads under a store calls import() under another store. The text of what it asks for comes in a later turn: the modules still read the store of that call, and what they ask for in the same way reads the store of its own call.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
const root = await store.run("outer", () => import("./root.mjs"));
see("main goes on with " + root.name);
await new Promise(resolve => (globalThis.lastHasRun = resolve));
see("main ends");

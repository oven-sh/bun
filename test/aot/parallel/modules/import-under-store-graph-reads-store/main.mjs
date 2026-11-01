// import() is called under a store of AsyncLocalStorage. What it loads reads that store: ES modules, a CommonJS file and what the file requires, a module that awaits and its importer, and the then() of a namespace. A graph that is loaded under no store reads none.
import { AsyncLocalStorage } from "node:async_hooks";
const store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
await store.run("modules", () => import("./modules.mjs"));
await store.run("file", () => import("./imports-file.mjs"));
await store.run("awaits", () => import("./imports-awaits.mjs"));
console.log("resolved with", await store.run("then", () => import("./thenable.mjs")));
await import("./without-store.mjs");
console.log("resolved with", await store.run("loaded", () => import("./thenable.mjs")));
see("main");

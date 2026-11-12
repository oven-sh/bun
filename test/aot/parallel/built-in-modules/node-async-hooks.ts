import * as library from "node:async_hooks";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
const storage = new library.AsyncLocalStorage<number>();
console.log(storage.run(7, () => storage.getStore()));

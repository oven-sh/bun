import * as library from "node:worker_threads";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
console.log(library.isMainThread, library.threadId);
const { port1, port2 } = new library.MessageChannel();
port1.close();
port2.close();

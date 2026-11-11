import * as library from "node:stream/web";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
console.log(new library.ReadableStream().locked);

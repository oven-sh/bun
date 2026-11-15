import * as library from "node:_stream_duplex";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
console.log(new library.default({ read() {}, write() {} }).writable);

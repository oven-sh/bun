import * as library from "node:buffer";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
console.log(library.Buffer.from("text").toString("base64"), library.isUtf8(library.Buffer.from("a")));

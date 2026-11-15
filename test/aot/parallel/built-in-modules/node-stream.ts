import * as library from "node:stream";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
for await (const piece of library.Readable.from(["a", "b"])) console.log(piece);
console.log(library.Readable.toWeb(library.Readable.from(["c"])) instanceof ReadableStream);

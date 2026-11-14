import * as library from "node:crypto";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
console.log(library.createHash("sha256").update("a").digest("hex").length, library.randomBytes(4).length);

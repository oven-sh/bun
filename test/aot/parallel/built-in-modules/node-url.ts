import * as library from "node:url";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
console.log(library.fileURLToPath("file:///a/b"), library.pathToFileURL("/a").href);

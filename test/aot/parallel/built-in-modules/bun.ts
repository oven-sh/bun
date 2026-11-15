import * as library from "bun";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
console.log(library.fileURLToPath("file:///a/b"), library.stringWidth("abc"), library.semver.satisfies("1.2.3", "^1.0.0"));

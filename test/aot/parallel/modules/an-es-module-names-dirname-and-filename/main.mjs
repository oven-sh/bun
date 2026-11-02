// `__dirname` and `__filename` in an ES module say where the file lay when the program was built. What `import.meta` answers lies under the root of the executable.
// Reference: bun build --compile
// Alone: it prints where it was built
import { existsSync, readFileSync } from "node:fs";
import inner from "./lib/inner.mjs";
console.log(__dirname);
console.log(__filename);
console.log(existsSync(__filename), readFileSync(__filename, "utf8").split("\n").length > 3);
console.log(inner.join("\n"));
console.log(import.meta.dir, import.meta.dirname);
const underRoot = text => text.startsWith(import.meta.dir) || text.startsWith("file://");
console.log(underRoot(import.meta.path), underRoot(import.meta.filename), underRoot(import.meta.url), import.meta.dir === __dirname);

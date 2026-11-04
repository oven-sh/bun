// `__dirname` and `__filename` in a TypeScript file say where the file lay when the program was built.
// Reference: bun build --compile
// Alone: it prints where it was built
import { existsSync } from "node:fs";
import { where } from "./lib/inner.ts";
const folder: string = __dirname;
const file: string = __filename;
console.log(folder);
console.log(file);
console.log(existsSync(file), existsSync(folder), file.startsWith(folder));
console.log(where.join("\n"));
let stored = __filename;
stored += "?";
console.log(stored);

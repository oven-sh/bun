// `import.meta.dir` in front of a name: of node:util the program keeps the one function that it imports.
// STATISTIC: FunctionsLowered <= 700
import { format } from "node:util";
const name = process.argv[5] ?? "one";
const part = await import(import.meta.dir + "/part-" + name + ".mjs");
console.log(format("%s", part.default));

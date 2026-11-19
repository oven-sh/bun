// lib.ts is imported for one name. The program asks for it again through values that hold a loader: a copy of `require`, `(0, require)`, what createRequire returns, module.require in a CommonJS file, and import() of a path that is put together. Each load finds the compiled file with every export.
import { createRequire } from "node:module";
import { imported } from "./lib.ts";
import { throughModuleRequire } from "./reader.cjs";

console.log(imported());
const load = require;
const ways = {
  "a copy": () => load("./lib.ts").throughCopy(),
  "a comma": () => (0, require)("./lib.ts").afterComma(),
  createRequire: () => createRequire(import.meta.url)("./lib.ts").throughCreateRequire(),
  "module.require": () => throughModuleRequire(),
  "import()": async () => (await import(["./lib", "ts"].join("."))).throughImport(),
};
for (const way in ways) {
  try {
    console.log(way + ":", await ways[way]());
  } catch (error) {
    console.log(way + ":", error.code, error.message.replace(/'[^']*lib\.ts'/, "'lib.ts'").split(" (bun compile")[0]);
  }
}
console.log(imported());

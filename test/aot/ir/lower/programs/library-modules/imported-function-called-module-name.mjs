// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// An export that is reassigned holds `require` at the first call and another function at the second. The program also loads by names that come from outside, so a string that is the name of a built-in module and goes somewhere as a value keeps the module. The output is that of plain Bun.
import { log, swap, swapped } from "./log.mjs";

log("dgram");
for (const name of process.env.NAMES.split(",")) {
  try {
    console.log(name, typeof require(name));
  } catch (error) {
    console.log(name, error.code);
  }
}
try {
  console.log(typeof swapped("repl"));
} catch (error) {
  console.log(error.code);
}
swap();
swapped("repl");

// FILE: log.mjs
export function log(text) {
  console.log("log:", text);
}
export let swapped = require;
export function swap() {
  swapped = log;
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

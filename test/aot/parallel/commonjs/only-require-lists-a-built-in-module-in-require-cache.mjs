import { createRequire } from "node:module";
import * as jsc from "bun:jsc";

const listed = name =>
  [name in require.cache, Object.keys(require.cache).includes(name), typeof require.cache[name]].join(" ");

function never() {
  return require("bun:jsc");
}

console.log("imported:", typeof jsc.heapSize, listed("bun:jsc"));
console.log("import():", typeof (await import("bun:sqlite")).Database, listed("bun:sqlite"));
console.log("getBuiltinModule:", typeof process.getBuiltinModule("bun:sqlite").Database, listed("bun:sqlite"));
const chosen = process.getBuiltinModule(jsc ? "bun:sqlite" : "bun:jsc");
console.log("getBuiltinModule:", typeof chosen.Database, listed("bun:sqlite"));
if (process.argv.length > 9) never();
console.log("a require() that never ran:", listed("bun:jsc"));
console.log("require:", require("bun:sqlite") === process.getBuiltinModule("bun:sqlite"), listed("bun:sqlite"));
console.log("createRequire:", typeof createRequire(import.meta.url)("bun:jsc").heapSize, listed("bun:jsc"));

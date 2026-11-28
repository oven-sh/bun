// DIAGNOSTIC: TS100089 main.mjs:9
// RUN: link
// CHECK: module {{*}}path="/$bunfs/root/part.mjs"
// CHECK-NOT: path="/$bunfs/root/other.mjs"

// FILE: main.mjs
// other.mjs, which only a guess brings, loads a file that nothing names, so no file comes in on a guess. part.mjs is imported for sure: `./part` finds it, and the build does not say that it is left out.
import { createRequire } from "node:module";
import { part } from "./part.mjs";
const table = { part: "./part", other: "./other" };
export const seen = JSON.stringify(table);
const load = createRequire(import.meta.url);
console.log(part);
console.log(load(table.part).part);
console.log(load(table.other).other);

// FILE: part.mjs
export const part = 1;

// FILE: other.mjs
export const other = import(globalThis.name);

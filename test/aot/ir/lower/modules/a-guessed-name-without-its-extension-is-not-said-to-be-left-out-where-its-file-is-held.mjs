// DIAGNOSTIC: TS100089 main.mjs:10
// RUN: link
// CHECK: module {{*}}path="/$bunfs/root/part.mjs"
// CHECK-NOT: path="/$bunfs/root/other.mjs"

// FILE: main.mjs
// silent.cjs leaves what it is to its loader, so no file comes in on a guess. part.mjs is imported for sure: `./part` finds it, and the build does not say that it is missing. `./other` is.
import { createRequire } from "node:module";
import "./silent.cjs";
import { part } from "./part.mjs";
const table = { part: "./part", other: "./other" };
export const seen = JSON.stringify(table);
const load = createRequire(import.meta.url);
console.log(part);
console.log(load(table.part).part);
console.log(load(table.other).other);

// FILE: silent.cjs
console.log("silent");

// FILE: part.mjs
export const part = 1;

// FILE: other.mjs
export const other = 2;

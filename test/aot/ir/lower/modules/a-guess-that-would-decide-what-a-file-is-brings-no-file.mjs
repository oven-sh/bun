// DIAGNOSTIC: TS100089 main.mjs:8
// RUN: link
// CHECK-NOT: path="/$bunfs/root/part.mjs"
// CHECK-NOT: path="/$bunfs/root/alone.mjs"
// CHECK-NOT: path="/$bunfs/root/silent.cjs" displayPath="silent.cjs" kind=CommonJs
// CHECK: module {{*}}path="node:module"

// FILE: main.mjs
// `table` is handed on, so the build can't prove what `table.part` holds at the call. The files whose names are written there would be brought on a guess. silent.cjs doesn't say
// what it is: whoever loads it first decides. The program imports it, and part.mjs, required, would load it as CommonJS: a guess says nothing about which comes first. A program
// that holds such a file gets no file on a guess: neither part.mjs nor alone.mjs, which leads nowhere near it, and silent.cjs is the ES module that the import makes of it.
import { createRequire } from "node:module";
const table = { part: "./part.mjs", alone: "./alone.mjs" };
export const seen = JSON.stringify(table);
export function later(key) {
  return createRequire(import.meta.url)(table[key]);
}
await import("./silent.cjs");

// FILE: alone.mjs
export const alone = 1;

// FILE: part.mjs
import "./silent.cjs";
export const part = 1;

// FILE: silent.cjs
globalThis.kind = (function () {
  return this === undefined;
})();

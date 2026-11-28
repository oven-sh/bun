// RUN(PART): link
// PART: module {{*}}path="/$bunfs/root/part.mjs"
// RUN(ALONE): link
// ALONE: module {{*}}path="/$bunfs/root/alone.mjs"
// A record says its kind where the module is no ES module.
// RUN(SILENT): link
// SILENT: module {{*}}path="{{*}}/silent.jsx" displayPath="{{*}}silent.jsx" flags=

// FILE: main.mjs
// `table` is handed on, so the build can't prove what `table.part` holds at the call. The files whose names are written there come in on a guess.
import { createRequire } from "node:module";
const table = { part: "./part.mjs", alone: "./alone.mjs" };
export const seen = JSON.stringify(table);
export function later(key) {
  return createRequire(import.meta.url)(table[key]);
}
await import("./silent.jsx");

// FILE: alone.mjs
export const alone = 1;

// FILE: part.mjs
import "./silent.jsx";
export const part = 1;

// FILE: silent.jsx
void __filename;
globalThis.kind = (function () {
  return this === undefined;
})();

// FILE: package.json
{ "type": "module" }

// A file hands on every name of another file, which hands on every name of a third, by the helper that TypeScript writes. Nothing has read a name when the heap snapshots are taken; the names are there behind them.
"use strict";
const barrel = require("./outer.js");
globalThis.kept = barrel;
console.log("snapshot", typeof Bun.generateHeapSnapshot());
console.log("one", barrel.one);
console.log("snapshot", typeof Bun.generateHeapSnapshot("v8"));
console.log("snapshot", typeof require("bun:jsc").generateHeapSnapshotForDebugging());
console.log("names", Object.keys(barrel).sort().join(), barrel.two);

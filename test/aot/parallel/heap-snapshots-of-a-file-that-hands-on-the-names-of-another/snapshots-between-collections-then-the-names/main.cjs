// A file hands on every name of another by the helper that TypeScript writes. Three heap snapshots are taken, each behind a collection, before anything reads a name; the names are there behind them.
"use strict";
const barrel = require("./barrel.js");
globalThis.kept = barrel;
for (let turn = 0; turn < 3; turn++) { Bun.gc(true); console.log("snapshot", turn, typeof Bun.generateHeapSnapshot()); }
console.log("names", Object.keys(barrel).sort().join(), barrel.one, barrel.two);

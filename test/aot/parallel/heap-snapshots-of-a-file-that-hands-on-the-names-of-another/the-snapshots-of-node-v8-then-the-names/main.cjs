// A file hands on every name of another by the helper that TypeScript writes. Nothing has read a name when node:v8 writes a heap snapshot into a file and streams another; the names are there behind them.
"use strict";
const barrel = require("./barrel.js");
globalThis.kept = barrel;
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), v8 = require("node:v8");
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-"));
const file = v8.writeHeapSnapshot(path.join(folder, "one.heapsnapshot"));
console.log("file", fs.statSync(file).size > 1000);
fs.rmSync(folder, { recursive: true });
let bytes = 0;
v8.getHeapSnapshot().on("data", chunk => { bytes += chunk.length; }).on("end", () => {
  console.log("stream", bytes > 1000);
  console.log("names", Object.keys(barrel).sort().join(), barrel.one, barrel.two);
});

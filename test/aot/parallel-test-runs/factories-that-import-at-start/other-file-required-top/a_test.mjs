import { test, vi, mock } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const said = [];
require("./lib.cjs");
const patched = mock.module("./lib.cjs", async () => { await import("./plain.mjs"); await 0; await 0; said.push("o" + require("./lib.cjs").n); return { n: -1 }; });
test("t", async () => {
said.push("t" + require("./lib.cjs").n); said.push("c" + require("./shared.cjs").shared());
await patched; for (let i = 0; i < 6; i++) await 0;
console.log("SAID", said.join(), require("./lib.cjs").n, (await import("./lib.cjs")).n, globalThis.runs);
});

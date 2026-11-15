import { test, vi, mock } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const said = [];
test("t", async () => {
require("./lib.cjs");
const patched = mock.module("./lib.cjs", async () => { const c = await import("./shared.cjs"); said.push("f" + c.shared()); await 0; await 0; said.push("o" + require("./lib.cjs").n); return { n: -1 }; });
said.push("t" + require("./lib.cjs").n); said.push("c" + require("./shared.cjs").shared());
await patched; for (let i = 0; i < 6; i++) await 0;
console.log("SAID", said.join(), require("./lib.cjs").n, (await import("./lib.cjs")).n, globalThis.runs);
});

import { test } from "bun:test";
import "./install.cjs";
import { seen } from "./north.mjs";
globalThis.said.push("in north: " + seen);
let both = 0;
for (let turn = 0; turn < 300; turn++) if (globalThis.listed() === "north.mjs,south.mjs") both++;
globalThis.said.push("behind: " + both);
test("what require.cache lists", () => {
  for (const line of globalThis.said) console.log(line);
  console.log("in the test:", globalThis.listed());
});

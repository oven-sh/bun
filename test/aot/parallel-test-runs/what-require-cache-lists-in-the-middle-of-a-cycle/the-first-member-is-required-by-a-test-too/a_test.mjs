import { test } from "bun:test";
import "./install.cjs";
import "./north.mjs";
globalThis.said.push("behind: " + globalThis.listed());
test("what require.cache lists", () => {
  for (const line of globalThis.said) console.log(line);
  console.log("in the test:", globalThis.listed());
});
test("required", () => {
  console.log(require("./north.mjs").name, require("./south.mjs").name, globalThis.listed());
});

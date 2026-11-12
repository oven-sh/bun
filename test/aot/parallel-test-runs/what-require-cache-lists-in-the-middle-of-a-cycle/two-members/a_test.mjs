import { test } from "bun:test";
import "./install.cjs";
import { seen } from "./north.mjs";
globalThis.said.push("in north: " + seen);
test("what require.cache lists", () => {
  for (const line of globalThis.said) console.log(line);
  console.log("in the test:", globalThis.listed());
});

import { test } from "bun:test";
import "./install.cjs";
import "./south.mjs";
globalThis.said.push("behind in b: " + globalThis.listed());
test("what require.cache lists", () => {
  for (const line of globalThis.said) console.log(line);
  console.log("in the test:", globalThis.listed());
});

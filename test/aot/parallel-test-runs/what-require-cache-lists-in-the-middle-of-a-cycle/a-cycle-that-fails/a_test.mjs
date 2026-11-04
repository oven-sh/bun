import { test } from "bun:test";
import "./install.cjs";
import "./hook.cjs";
globalThis.said.push("north: " + globalThis.hook());
globalThis.said.push("behind: " + globalThis.listed());
test("what require.cache lists", () => {
  for (const line of globalThis.said) console.log(line);
  console.log("in the test:", globalThis.listed());
});

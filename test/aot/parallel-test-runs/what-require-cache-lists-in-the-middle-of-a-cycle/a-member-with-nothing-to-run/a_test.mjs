import { test } from "bun:test";
import "./install.cjs";
import { name } from "./north.mjs";
globalThis.said.push("behind: " + name + " " + globalThis.listed());
test("what require.cache lists", () => {
  for (const line of globalThis.said) console.log(line);
  console.log("in the test:", globalThis.listed());
});

// One test file imports it by a statement and requires it.
import { test } from "bun:test";
import "./plain.cjs";
test("the mode", () => {
  console.log(globalThis.seen.join(" "), typeof require("./plain.cjs"));
});

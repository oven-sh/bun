// plain.cjs says nothing of CommonJS. The statements below the test file have loaded it by the time the test requires the module above it.
import { test } from "bun:test";
import "./middle.mjs";
test("the order and the mode", () => {
  console.log(globalThis.seen.join(" "), require("./middle.mjs").name);
});

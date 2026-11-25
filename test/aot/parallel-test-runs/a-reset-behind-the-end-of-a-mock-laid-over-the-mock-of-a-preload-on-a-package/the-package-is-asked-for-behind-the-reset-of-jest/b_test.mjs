import { test } from "bun:test";
test("the next test file begins with the mock of the preload", () => {
  console.log("SAID next", require("crate").kind);
});

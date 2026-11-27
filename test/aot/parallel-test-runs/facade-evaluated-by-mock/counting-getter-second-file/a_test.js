// A CommonJS facade that only a mock call has evaluated: a counting getter is read once, and the second test file imports the module.
import { test, mock } from "bun:test";
const box = require("./box.cjs");
test("t", () => {
  mock.module("./box.cjs", () => ({ a: "mocked" }));
  console.log("a", typeof box, typeof require("./box.cjs"));
});

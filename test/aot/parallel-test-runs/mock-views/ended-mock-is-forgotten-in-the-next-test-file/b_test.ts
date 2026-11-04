import { test } from "bun:test";
import { read } from "./reader";

// The body of lib never ran in the first test file: the mock stood in its place.
test("the next test file finds the module", () => {
  console.log("b:", read());
});

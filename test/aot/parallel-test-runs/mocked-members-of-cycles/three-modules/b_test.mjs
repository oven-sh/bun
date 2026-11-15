import { test } from "bun:test";
import { a } from "./a.mjs";

test("the next test file", () => {
  console.log("SAID two", a());
});

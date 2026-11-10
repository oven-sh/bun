import { test } from "bun:test";
import { label } from "./a_test.ts";
test("b", () => {
  console.log("SAID b", label);
});

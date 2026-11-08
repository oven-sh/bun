import { test, expect } from "bun:test";
import { kindOf } from "./kinds.mjs";
test("the store to the expression's own name throws", () => {
  console.log(kindOf(1), kindOf("a"));
  expect(kindOf(1)).toBe("TypeError");
});

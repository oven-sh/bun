import { test, expect } from "bun:test";
import { add, subtract } from "./demo";

test("add function", () => {
  expect(add(2, 3)).toBe(5);
});

test("subtract function", () => {
  expect(subtract(5, 3)).toBe(2);
});
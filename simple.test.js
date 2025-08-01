// Test just the original syntax first to make sure it works
import { test, expect } from "bun:test";

test("original syntax still works", () => {
  expect(true).toBe(true);
}, { timeout: 1000 });

console.log("Original syntax test defined successfully");
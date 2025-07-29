import { test, expect } from "bun:test";

console.log("This file is being loaded");

test("test 1", () => {
  console.log("Running test 1");
  expect(1 + 1).toBe(2);
});

test("test 2", () => {
  console.log("Running test 2");
  expect(2 + 2).toBe(4);
});
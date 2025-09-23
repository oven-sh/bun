import { test, expect } from "bun:test";

test.concurrent("test 1 in concurrent-1", () => {
  console.log("Running test 1 in concurrent-1");
  expect(1).toBe(1);
});

test.concurrent("test 2 in concurrent-1", () => {
  console.log("Running test 2 in concurrent-1");
  expect(2).toBe(2);
});
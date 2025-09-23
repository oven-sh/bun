import { test, expect } from "bun:test";

let counter = 0;

test("test 1 in sequential", () => {
  counter++;
  console.log("Running test 1 in sequential, counter:", counter);
  expect(counter).toBe(1);
});

test("test 2 in sequential", () => {
  counter++;
  console.log("Running test 2 in sequential, counter:", counter);
  expect(counter).toBe(2);
});
// Probe: what a test file reports when the code that builds its tables throws.
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
test("before", () => {
  expect(1).toBe(1);
});
describe("a block whose table cannot be built", () => {
  const names = readdirSync("/no/such/corpus");
  test.each(names)("round trip of %s", () => {});
});
test("after", () => {
  expect(1).toBe(1);
});

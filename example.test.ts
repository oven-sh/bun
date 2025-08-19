import { describe, test, expect } from "bun:test";

test("this test passes", () => {
  expect(1).toBe(1);
});

test("this test fails", () => {
  expect(1).toBe(2);
});

await describe.forDebuggingExecuteTestsNow();
describe.forDebuggingDeinitNow();

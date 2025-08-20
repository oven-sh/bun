import { describe, test, expect } from "bun:test";

test("this test passes", () => {
  expect(1).toBe(1);
});

test("this test fails", () => {
  expect(1).toBe(2);
});

describe("inside describe", () => {
  test("this test is in a describe", () => {
    expect(1).toBe(1);
  });
});

await describe.forDebuggingExecuteTestsNow();
describe.forDebuggingDeinitNow();

import { describe, expect, test } from "bun:test";

// Simple passing test
test("adds numbers correctly", () => {
  expect(1 + 2).toBe(3);
});

// Simple failing test
test("subtracts numbers incorrectly", () => {
  expect(5 - 2).toBe(10); // This will fail
});

describe("isEmail", () => {
  test("valid emails", () => {
    expect(isEmail("test@example.com")).toBe(true);
    expect(isEmail("foo.bar@domain.co")).toBe(true);
  });

  test("invalid emails", () => {
    expect(isEmail("not-an-email")).toBe(false);
    expect(isEmail("missing@at")).toBe(true);
  });
});

// Nested describe
describe("Array utilities", () => {
  function sum(arr: number[]): number {
    return arr.reduce((a, b) => a + b, 0);
  }
  // describe()
  describe("sum()", () => {
    test(
      "sums positive numbers",
      async () => {
        await Bun.sleep(10000);
        expect(sum([1, 2, 3])).toBe(7);
      },
      { timeout: 10 },
    ); // Custom timeout

    test.skip("sums negative numbers", () => {
      expect(sum([-1, -2, -3])).toBe(-6);
    });

    test("empty array returns 0", () => {
      expect(sum([])).toBe(0);
    });
  });
});

// test.each example
describe("multiply", () => {
  function multiply(a: number, b: number) {
    return a * b;
  }

  test.each([
    [2, 3, 6],
    [0, 5, 0],
    [-1, 8, -8],
    [7, -2, -14],
    [2, 2, 5],
  ])("multiply(%i, %i) === %i", (a, b, expected) => {
    expect(multiply(a, b)).toBe(expected);
  });
});

function isEmail(str: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
}

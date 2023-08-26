import { describe, test, expect } from "bun:test";

describe("example", () => {
  test("it works", () => {
    expect(1).toBe(1);
    expect(1).not.toBe(2);
    expect(() => {
      throw new Error("error");
    }).toThrow();
  });
});

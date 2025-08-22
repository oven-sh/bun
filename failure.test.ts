import { describe, expect, test } from "bun:test";

describe("failure", () => {
  test("should fail", () => {
    expect(1).toBe(2);
  });
});

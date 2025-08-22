import { afterAll, describe, expect, test, afterEach } from "bun:test";

describe("failure", () => {
  test("should fail", () => {
    // expect(1).toBe(2);
  });
  test.failing("should pass", () => {
    expect(1).toBe(1);
  });
  test.failing("should fail", () => {
    expect(1).toBe(2);
  });
});

describe("afterEach demo", () => {
  test("should pass", () => {
    expect(1).toBe(1);
  });
  test("should fail", () => {
    expect(1).toBe(2);
  });
  afterEach(() => {
    throw new Error("error in afterEach");
  });
});

afterAll(() => {
  throw new Error("error in afterAll");
});

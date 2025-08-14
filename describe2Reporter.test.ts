// Test file for describe2 implementation with success/failure reporting
import { test, describe, expect } from "bun:test";

describe("Test Suite", () => {
  test("passing test", () => {
    expect(1 + 1).toBe(2);
  });
  
  test("another passing test", () => {
    expect(true).toBe(true);
  });
  
  test("async test", async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(2 + 2).toBe(4);
  });
});

describe("Another Suite", () => {
  test("test with multiple expectations", () => {
    expect(1).toBe(1);
    expect(2).toBe(2);
    expect(3).toBe(3);
  });
  
  test("failing test", () => {
    expect(1 + 1).toBe(3); // This will fail
  });
});

describe("Skip and Todo tests", () => {
  test.skip("skipped test", () => {
    expect(true).toBe(false);
  });
  
  test.todo("todo test");
});
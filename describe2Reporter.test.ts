// Test file for describe2 implementation with success/failure reporting
import { test, describe, expect } from "bun:test";

describe("Test Suite", () => {
  test("passing test", () => {
    console.log("passing test line 1");
    expect(1 + 1).toBe(2);
  });

  test("another passing test", () => {
    console.log("another passing test line 1");
    expect(true).toBe(true);
  });

  test("async test", async () => {
    console.log("async test line 1");
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(2 + 2).toBe(4);
  });
});

describe("Another Suite", () => {
  test("test with multiple expectations", () => {
    console.log("test with multiple expectations line 1");
    expect(1).toBe(1);
    expect(2).toBe(2);
    expect(3).toBe(3);
  });

  test("failing test", () => {
    console.log("failing test line 1");
    expect(1 + 1).toBe(3); // This will fail
    // TODO: fix this causing a tickWithoutIdle loop?
    // the cause is that this is in a then callback. it throws, but that goes uncaught for some reason?
    // then for some reason it does not trigger an uncaught error handler
    // and then we are in `await never` which triggers tickWithoutIdle
  });
});

describe("Skip and Todo tests", () => {
  test.skip("skipped test", () => {
    expect(true).toBe(false);
  });

  test.todo("todo test");
});

setInterval(() => {}, 1000);
await describe.forDebuggingExecuteTestsNow();

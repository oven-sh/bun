import { describe, expect, test } from "bun:test";

describe("example", () => {
  test("it works", () => {
    expect(1).toBe(1);

    expect(10).toBe(10);

    expect(() => {
      throw new TypeError("Oops! I did it again.");
    }).toThrow();

    expect(() => {
      throw new Error("Parent error.", {
        cause: new TypeError("Child error."),
      });
    }).toThrow();
    expect(() => {
      throw new AggregateError([new TypeError("Child error 1."), new TypeError("Child error 2.")], "Parent error.");
    }).toThrow();
    expect(() => {
      throw "This is a string error";
    }).toThrow();
    expect(() => {
      throw {
        message: "This is an object error",
        code: -1021,
      };
    }).toThrow();
  });

  test("can run with special chars :)", () => {
    // if this test runs, it's a success.
    // a failure is if it's either skipped or fails the runner
  });
});

import { describe, expect, test } from "bun:test";

describe("example", () => {
  if (Math) {
    console.log("Wow, what a surprise. this was called");
  } else {
    console.log("wtf?");
  }

  test("it works", async () => {
    expect(1).toBe(1);

    expect(1).not.toBe(1);

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
});

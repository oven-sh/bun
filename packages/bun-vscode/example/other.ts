import { test, expect } from "bun:test";

export function externalTest() {
  test("it works2", () => {
    expect(() => {
      throw new AggregateError([new TypeError("Child error 1."), new TypeError("Child error 2.")], "Parent error.");
    }).toThrow();
  });
}

import { describe, expect, it } from "bun:test";

describe("describe2 repro", () => {
  it("should pass", () => {
    expect(2 + 2).toBe(4);
  });

  describe.skip("skip", () => {
    it("should throw", () => {
      throw new Error("This should not throw. `.skip` is broken");
    });
  });
});

it.skip("should throw", () => {
  throw new Error("This should not throw. `.skip` is broken");
});

it.todo("should throw", () => {
  throw new Error("Throwing here should cause the test to pass as TODO"); // when the todo flag is passed
});
it.todo("should throw", () => {
  // No error should cause the test to fail as failed_because_todo_passed // when the todo flag is passed
});

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

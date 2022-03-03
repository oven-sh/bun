import { it, expect } from "bun:test";

it("inspect", () => {
  expect(Bun.inspect(new TypeError("what")).includes("TypeError: what")).toBe(
    true
  );
});

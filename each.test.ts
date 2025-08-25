import { describe, test, expect } from "bun:test";

describe.each([1, 2, 3])("each", num => {
  test.each(["a", "b", "c"])("each", str => {
    expect(`${num}-${str}`).toBe(`${num}-${str}`);
  });
});

import { describe, test, expect } from "bun:test";

describe.each([1, 2, 3])("each %p", num => {
  test.each(["a", "b", "c"])("each %p", str => {
    expect(`${num}-${str}`).toBe(`${num}-${str}`);
  });
});

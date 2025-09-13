import { describe, expect, test } from "bun:test";

describe.each(["foo", "bar"])("%s", val => {
  console.log(val);
  test.only("works", () => {
    expect(1).toBe(1);
  });
});

import { test, expect } from "bun:test";

test("new expect() matchers", () => {
  expect(1).not.toBe(2);
  expect({ a: 1 }).toEqual({ a: 1, b: undefined });
  expect({ a: 1 }).toStrictEqual({ a: 1 });
  expect(new Set()).toHaveProperty("size");
  expect([]).toHaveLength(0);
  expect(["bun"]).toContain("bun");
  expect(true).toBeTruthy();
  expect(Math.PI).toBeGreaterThan(3.14);
  expect(null).toBeNull();
});

import { expect, mock, test } from "bun:test";
mock.module("./crate.cjs", () => ({ shown: 30, default: 20 }));
const { shown, default: value } = await import("./crate.cjs");
test("the names are those of the mock", () => {
  expect(String(shown)).toBe("30");
  expect(String(value)).toBe("20");
});

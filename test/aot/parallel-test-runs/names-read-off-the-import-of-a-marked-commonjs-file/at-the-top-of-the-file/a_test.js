import { expect, test } from "bun:test";
const { shown, default: value } = await import("./crate.cjs");
const member = (await import("./crate.cjs")).shown;
test("the names of a marked file are read off its import", () => {
  expect(String(shown)).toBe("3");
  expect(String(value)).toBe("2");
  expect(String(member)).toBe("3");
});

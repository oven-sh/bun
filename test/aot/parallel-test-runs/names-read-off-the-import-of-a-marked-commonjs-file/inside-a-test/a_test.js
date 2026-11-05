import { expect, test } from "bun:test";
test("the names of a marked file are read off its import inside a test", async () => {
  const { shown, default: value } = await import("./crate.cjs");
  expect(String(shown)).toBe("3");
  expect(String(value)).toBe("2");
  expect(String((await import("./crate.cjs")).shown)).toBe("3");
});

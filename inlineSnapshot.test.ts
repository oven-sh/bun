import { test, expect } from "bun:test";

test("inline snapshot", () => {
  expect("abc").toMatchInlineSnapshot();
});

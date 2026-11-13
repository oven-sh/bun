import { test } from "bun:test";
const { shown, default: value } = await import("./crate.cjs");
const member = (await import("./crate.cjs")).shown;
test("the names of a marked file are read off its import", () => {
  console.log(String(shown), String(value), String(member));
});

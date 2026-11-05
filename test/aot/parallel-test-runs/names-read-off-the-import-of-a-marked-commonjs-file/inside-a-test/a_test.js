import { test } from "bun:test";
test("the names of a marked file are read off its import inside a test", async () => {
  const { shown, default: value } = await import("./crate.cjs");
  console.log(String(shown), String(value), String((await import("./crate.cjs")).shown));
});

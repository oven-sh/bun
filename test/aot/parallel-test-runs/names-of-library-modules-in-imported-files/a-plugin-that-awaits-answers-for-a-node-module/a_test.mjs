import { test } from "bun:test";
test("require() in front of the import and behind it", async () => {
  console.log(require("os").from, require("os").from, (await import("os")).from, require("os").from);
});

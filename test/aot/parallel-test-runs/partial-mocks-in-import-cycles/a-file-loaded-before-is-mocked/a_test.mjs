import { test } from "bun:test";
test("the first file has the original", async () => {
  console.log((await import("./shop.mjs")).describe());
});

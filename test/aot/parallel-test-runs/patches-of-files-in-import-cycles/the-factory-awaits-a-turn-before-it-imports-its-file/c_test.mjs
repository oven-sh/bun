import { test } from "bun:test";
test("the next file has the original", async () => {
  console.log((await import("./cart.mjs")).total());
});

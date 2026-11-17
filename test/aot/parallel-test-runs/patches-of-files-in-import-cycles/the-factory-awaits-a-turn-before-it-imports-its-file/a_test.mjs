import { test } from "bun:test";
test("the first file loads both", async () => {
  console.log((await import("./cart.mjs")).total());
});

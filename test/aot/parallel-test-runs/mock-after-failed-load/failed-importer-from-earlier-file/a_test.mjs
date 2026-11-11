import { test } from "bun:test";
test("the oven trips in the first file", async () => {
  const said = await import("./bakery.mjs").then(() => "loaded", error => error.message);
  console.log("SAID first file", said, globalThis.shelfRan ?? 0);
});

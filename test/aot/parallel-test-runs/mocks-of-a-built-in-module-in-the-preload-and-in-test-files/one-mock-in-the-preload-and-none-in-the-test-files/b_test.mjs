import { test } from "bun:test";
test("b", async () => {
  console.log("SAID b", globalThis.first.late(), (await import("./fresh-b.mjs")).late());
});

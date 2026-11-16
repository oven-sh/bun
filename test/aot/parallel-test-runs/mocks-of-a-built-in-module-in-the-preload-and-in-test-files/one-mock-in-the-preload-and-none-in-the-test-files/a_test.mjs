import { test, mock, vi } from "bun:test";
test("a", async () => {
  console.log("SAID a before", globalThis.first.late(), (await import("./fresh-a.mjs")).late());
});

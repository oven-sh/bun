import { test, vi } from "bun:test";
test("a", async () => {
  console.log("SAID a", (await import("./top.mjs")).top());
});

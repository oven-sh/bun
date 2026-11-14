import { test, vi } from "bun:test";
test("c", async () => {
  console.log("SAID c", (await import("./top.mjs")).top());
});

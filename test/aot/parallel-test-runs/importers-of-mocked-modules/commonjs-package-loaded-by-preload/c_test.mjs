import { test } from "bun:test";
test("c", async () => {
  console.log("SAID c", (await import("./second.mjs")).second(), "second ran", globalThis.secondRan);
});

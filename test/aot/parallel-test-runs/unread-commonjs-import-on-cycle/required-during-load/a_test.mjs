import { test } from "bun:test";
test("t", async () => {
  await import("./main.mjs");
});

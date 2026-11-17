import { test, vi } from "bun:test";
test("the middle test file", async () => {
  const got = await import("./bin.mjs");
  console.log("SAID middle", got.o);
});

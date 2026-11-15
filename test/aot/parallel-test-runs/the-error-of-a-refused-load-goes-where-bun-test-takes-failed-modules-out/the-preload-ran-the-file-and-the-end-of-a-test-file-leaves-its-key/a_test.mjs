import { test, vi } from "bun:test";
test("the first test file", async () => {
  vi.doUnmock("./bin.mjs");
  const got = await import("./bin.mjs");
  console.log("SAID", got.o);
});

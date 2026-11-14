import { test, vi } from "bun:test";
test("the first test file runs the file itself", async () => {
  vi.doUnmock("./bin.mjs");
  console.log("SAID", (await import("./bin.mjs")).o);
});

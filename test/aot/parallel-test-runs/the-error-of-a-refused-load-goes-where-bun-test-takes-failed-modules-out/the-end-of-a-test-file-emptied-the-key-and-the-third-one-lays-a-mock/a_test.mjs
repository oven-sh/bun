import { test, vi } from "bun:test";
test("the first test file", async () => {
  vi.doUnmock("./bin.cjs");
  const got = require("./bin.cjs");
  console.log("SAID", got.o);
});

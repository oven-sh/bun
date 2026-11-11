import { test, vi } from "bun:test";

// A mock without a factory replaces the functions of the file. `bun test` undoes the mocks of a test file first and lets the load in flight end: the call gets the file itself.
test("the test ends at once", () => {
  vi.doMock("./part.mjs");
  import("./part.mjs").then(it => console.log("came", Object.keys(it).join(), "| a mock:", vi.isMockFunction(it.total), "|", String(it.total()), "|", String(it.missing)));
  console.log("the test ends", String(globalThis.timesRun));
});

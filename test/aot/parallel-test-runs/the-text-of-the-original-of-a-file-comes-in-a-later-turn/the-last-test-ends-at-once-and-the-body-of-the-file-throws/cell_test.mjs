import { test, vi } from "bun:test";

// Nobody awaits the call and the test ends at once. `bun test` has a read under way: the body runs behind the test, and its error fails the run.
test("the test passes and the run fails", () => {
  vi.doMock("./part.mjs");
  void import("./part.mjs");
  console.log("the test ends", String(globalThis.timesRun));
});

import { test, vi } from "bun:test";

// The load in flight has the name of the file in `__mocks__` already. That file runs, though the tests of this file are done.
test("the call is left in flight", () => {
  vi.doMock("./part.mjs");
  import("./part.mjs");
  console.log("the test ends");
});

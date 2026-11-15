import { afterEach, test, vi } from "bun:test";

// The mock below gives the file itself where the tests of the file are done, so the real body of that file runs for the mock, in front of the graph of the file of the call. It never ends, and the runner does not wait for it.
test("the call is left in flight", () => {
  vi.doMock("./below.mjs", () => ({ depth: "mocked" }));
  vi.doMock("./part.mjs", async original => ({ ...(await original()), mocked: true }));
  setInterval(() => {}, 1000);
  import("./part.mjs").then(
    it => console.log("the call came:", it.opening, it.mocked),
    error => console.log("the call failed:", error.message),
  );
  console.log("the test ends");
});
afterEach(() => {
  vi.doUnmock("./part.mjs");
});

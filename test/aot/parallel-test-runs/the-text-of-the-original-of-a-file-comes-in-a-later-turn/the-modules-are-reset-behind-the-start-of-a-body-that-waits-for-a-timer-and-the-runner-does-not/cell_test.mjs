import { afterEach, test, vi } from "bun:test";

// The reset in the second test takes out what the loader holds of the original. Its body had begun by then: where the tests of the file are done the runner does not wait for it.
const begun = new Promise(done => (globalThis.hasBegun = done));
test("the call is left in flight", () => {
  vi.doMock("./part.mjs", async original => ({ ...(await original()), mocked: true }));
  import("./part.mjs").then(
    it => console.log("the call came:", it.opening, it.mocked),
    error => console.log("the call failed:", error.name),
  );
  console.log("the test ends");
});
afterEach(() => {
  vi.doUnmock("./part.mjs");
});
test("the modules are reset", async () => {
  await begun;
  vi.resetModules();
  console.log("the modules are reset");
});

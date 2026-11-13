// The end of the test's mock brings back what lay under the key, and registers nothing. jest.resetModules() loads packages again: the real one comes.
import { test, vi, jest } from "bun:test";
test("one", async () => {
  vi.doMock("crate", () => ({ kind: "of the test" }));
  console.log("SAID under", require("crate").kind);
  vi.doUnmock("crate");
  console.log("SAID ended", require("crate").kind);
  jest.resetModules();
  console.log("SAID reset", require("crate").kind, (await import("crate")).kind);
});

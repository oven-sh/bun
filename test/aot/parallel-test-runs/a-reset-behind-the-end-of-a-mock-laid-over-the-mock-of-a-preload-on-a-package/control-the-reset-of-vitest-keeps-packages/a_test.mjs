import { test, vi } from "bun:test";
test("one", async () => {
  vi.doMock("crate", () => ({ kind: "of the test" }));
  console.log("SAID under", require("crate").kind);
  vi.doUnmock("crate");
  console.log("SAID ended", require("crate").kind);
  vi.resetModules();
  console.log("SAID reset", require("crate").kind, (await import("crate")).kind);
});

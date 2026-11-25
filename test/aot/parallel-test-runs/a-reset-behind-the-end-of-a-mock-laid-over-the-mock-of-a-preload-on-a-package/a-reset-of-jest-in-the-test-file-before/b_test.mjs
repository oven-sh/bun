import { test, vi } from "bun:test";
test("two", () => {
  vi.doMock("crate", () => ({ kind: "of the test" }));
  console.log("SAID under", require("crate").kind);
  vi.doUnmock("crate");
  console.log("SAID ended", require("crate").kind);
});

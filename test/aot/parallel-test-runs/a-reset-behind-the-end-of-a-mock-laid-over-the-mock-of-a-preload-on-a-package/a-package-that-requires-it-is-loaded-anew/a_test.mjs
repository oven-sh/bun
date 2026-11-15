import { test, vi, jest } from "bun:test";
test("one", () => {
  const held = require("user-of-crate");
  vi.doMock("crate", () => ({ kind: "of the test" }));
  vi.doUnmock("crate");
  jest.resetModules();
  console.log("SAID reset", held.read(), require("user-of-crate").read());
});

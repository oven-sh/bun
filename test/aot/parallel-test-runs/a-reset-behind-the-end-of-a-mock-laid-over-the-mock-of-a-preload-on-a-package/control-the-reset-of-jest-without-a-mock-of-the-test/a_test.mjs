import { test, jest } from "bun:test";
test("one", async () => {
  console.log("SAID first", require("crate").kind);
  jest.resetModules();
  console.log("SAID reset", require("crate").kind, (await import("crate")).kind);
});

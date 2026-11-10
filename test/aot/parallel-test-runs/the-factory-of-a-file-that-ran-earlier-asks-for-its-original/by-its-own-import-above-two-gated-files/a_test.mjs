import { test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("./one.mjs", () => ({ one: "mocked" }));
  vi.doMock("./two.mjs", () => ({ two: "mocked" }));
  const lib = await import("./lib.mjs");
  console.log("SAID a " + lib.read());
});

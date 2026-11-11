import { test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("./dep.mjs", () => ({ value: "mocked" }));
  console.log("SAID a " + (await import("./lib.mjs")).read());
});

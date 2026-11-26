import { test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("./data.json", () => ({ default: "mock" }));
  console.log((await import("./user.mjs")).seen());
  vi.doUnmock("./data.json");
  vi.resetModules();
  console.log((await import("./user.mjs")).seen());
});

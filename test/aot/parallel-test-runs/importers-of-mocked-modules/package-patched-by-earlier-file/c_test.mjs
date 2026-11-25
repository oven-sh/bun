import { test, vi } from "bun:test";
test("c", async () => {
  console.log("SAID c", (await import("./user.mjs")).user());
  vi.doMock("kiln", () => ({ default: { fire: () => "mock" }, fire: () => "mock" }));
  console.log("SAID c", (await import("./user.mjs")).user());
});

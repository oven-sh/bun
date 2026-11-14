import { test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("kiln", () => ({ default: { fire: () => "mock" }, fire: () => "mock" }));
  console.log("SAID a", (await import("./outer.mjs")).outer());
});

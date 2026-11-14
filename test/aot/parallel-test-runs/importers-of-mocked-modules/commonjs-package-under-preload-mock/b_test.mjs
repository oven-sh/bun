import { test, vi } from "bun:test";
import { second } from "./second.mjs";
test("b", async () => {
  vi.doMock("kiln", () => ({ default: { fire: () => "mock" }, fire: () => "mock" }));
  console.log("SAID b", second(), (await import("./second.mjs")).second(), "second ran", globalThis.secondRan);
});

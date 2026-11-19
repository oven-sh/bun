import { test, vi } from "bun:test";
test("b", async () => {
  const { user } = await import("./user.mjs");
  vi.doMock("./leaf.cjs", () => ({ default: { fire: () => "mock" }, fire: () => "mock" }));
  console.log("SAID b", user(), (await import("./other.mjs")).other());
  vi.doUnmock("./leaf.cjs");
  console.log("SAID b", (await import("./user.mjs")).user(), (await import("./other.mjs")).other());
});

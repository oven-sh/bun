import { test, vi } from "bun:test";
test("b", async () => {
  console.log("SAID b", (await import("./barrel.mjs")).user());
  vi.doMock("./leaf.mjs", () => ({ leaf: "mock" }));
});

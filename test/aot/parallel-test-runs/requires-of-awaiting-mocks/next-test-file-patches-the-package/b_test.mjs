import { jest, mock, test, vi } from "bun:test";
mock.module("@made-up/tax", () => ({ rate: "mock" }));
test("b", async () => {
  console.log("b actual", (await vi.importActual("@made-up/tax")).rate);
  console.log("b import", (await import("@made-up/tax")).rate);
});

import { jest, test, vi } from "bun:test";
test("b", async () => {
  jest.doMock("@made-up/tax", () => ({ ...jest.requireActual("@made-up/tax"), rate: "mock" }));
  console.log("b", (await vi.importActual("@made-up/tax")).rate, (await import("@made-up/tax")).rate);
});

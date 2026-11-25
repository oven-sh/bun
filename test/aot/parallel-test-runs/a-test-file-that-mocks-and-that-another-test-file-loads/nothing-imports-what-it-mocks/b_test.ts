import { test, vi } from "bun:test";
globalThis.runs = (globalThis.runs ?? 0) + 1;
test("b", async () => {
  vi.doMock("./rates", () => ({ rate: () => "mock" }));
  console.log("b", (await import("./totals")).total(), "run", globalThis.runs);
});

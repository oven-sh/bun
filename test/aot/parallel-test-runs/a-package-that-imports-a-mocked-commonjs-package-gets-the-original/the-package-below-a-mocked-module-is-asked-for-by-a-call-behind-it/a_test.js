import { test, vi, jest, mock } from "bun:test";
vi.mock("dep", () => ({ value: () => "mocked" }));
vi.mock("./wrap.mjs", () => ({ wrapped: () => "mocked wrap" }));
test("t", async () => {
  const { own } = await import("./own.mjs");
  console.log("SAID", own(), String(globalThis.order));
  const { seen } = await import("reads");
  console.log("SAID", seen(), String(globalThis.order));
});

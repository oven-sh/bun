import { test, vi, jest, mock } from "bun:test";
vi.mock("dep", () => ({ value: () => "mocked" }));
vi.mock("outer", () => ({ wrapped: () => "mocked outer" }));
test("t", async () => {
  const { own } = await import("./own.mjs");
  console.log("SAID", own(), String(globalThis.order));
});

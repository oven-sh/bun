import { test, vi } from "bun:test";
vi.mock("dep", () => ({ value: () => "mocked" }));
vi.mock("./wrap.mjs", () => ({ wrapped: () => "mocked wrap" }));
test("t", async () => {
  const { own } = await import("./own.mjs");
  console.log("SAID", own(), String(globalThis.runs));
});

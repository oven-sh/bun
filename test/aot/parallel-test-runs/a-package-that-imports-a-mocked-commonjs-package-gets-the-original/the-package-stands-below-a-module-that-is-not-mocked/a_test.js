import { test, vi } from "bun:test";
vi.mock("dep", () => ({ value: () => "mocked" }));
test("t", async () => {
  const { own } = await import("./own.mjs");
  console.log("SAID", own(), String(globalThis.runs));
});

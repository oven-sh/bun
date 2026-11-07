import { test, vi, jest, mock } from "bun:test";
vi.mock("dep", () => ({ value: () => "mocked", kind: "mocked" }));
test("t", async () => {
  const { own } = await import("./own.mjs");
  console.log("SAID own", own());
  for (const turn of [1, 2]) {
    try { const { seen } = await import("reads"); console.log("SAID", turn, await seen(), String(globalThis.runs)); } catch (e) { console.log("SAID", turn, "threw", String(e.message).slice(0, 40), String(globalThis.runs)); }
  }
  console.log("SAID own", own());
});

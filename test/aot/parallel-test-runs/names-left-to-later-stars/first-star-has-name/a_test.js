import { test, vi, mock } from "bun:test";
test("t", async () => {
  vi.doMock("./leaf2.mjs", () => ({ n1: "mock:n1" }));
  try { console.log("SAID 1", String(await (await import("./reader.mjs")).look())); } catch (e) { console.log("SAID 1", e.name); }
});

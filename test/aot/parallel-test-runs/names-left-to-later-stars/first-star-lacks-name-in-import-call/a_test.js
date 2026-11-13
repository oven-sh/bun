import { test, vi, mock } from "bun:test";
test("t", async () => {
  vi.doMock("./leaf2.mjs", () => ({ n0: "mock:n0" }));
  try { console.log("SAID 1", String(await (await import("./reader.mjs")).look())); } catch (e) { console.log("SAID 1", e.name); }
});

import { test, vi, mock } from "bun:test";
test("t", async () => {
  vi.doMock("./leaf2.mjs", () => ({}));
  try { console.log("SAID 1", String(await (await import("./reader.mjs")).look())); } catch (e) { console.log("SAID 1", e.name); }
  vi.doUnmock("./leaf2.mjs");
  try { console.log("SAID 2", String(await (await import("./reader2.mjs")).look())); } catch (e) { console.log("SAID 2", e.name); }
});

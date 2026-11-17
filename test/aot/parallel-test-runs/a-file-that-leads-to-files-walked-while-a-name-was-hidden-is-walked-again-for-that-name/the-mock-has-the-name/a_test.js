import { test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("./shapes.mjs", () => ({ round: 10 }));
  try { console.log("SAID", String((await import("./reader.mjs")).look())); } catch (e) { console.log("SAID", e.name); }
});

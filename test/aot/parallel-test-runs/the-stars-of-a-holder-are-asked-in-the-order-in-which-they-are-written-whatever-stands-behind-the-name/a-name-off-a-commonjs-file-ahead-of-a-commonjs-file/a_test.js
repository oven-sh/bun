import { test, vi } from "bun:test";
test("one name imported", async () => {
  vi.doMock("./d.cjs", () => ({ round: "added d" }));
  try { console.log("SAID case", (await import("./case.mjs")).look()); } catch (e) { console.log("SAID case", e.name); }
});

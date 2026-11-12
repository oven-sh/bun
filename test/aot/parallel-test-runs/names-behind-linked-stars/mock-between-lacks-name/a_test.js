import { test, vi, mock } from "bun:test";
test("t", async () => {
  vi.doMock("./b0.mjs", () => ({  }));
  for (const name of ["n0", "n1", "n2"]) {
    try { console.log("SAID", name, String((await import("./named-" + name + ".mjs")).look())); } catch (e) { console.log("SAID", name, e.name, e.message); }
  }
  try { console.log("SAID keys", Object.keys(await import("./b4.mjs")).join()); } catch (e) { console.log("SAID keys", e.name, e.message); }
});

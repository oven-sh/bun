import { test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("./shapes.mjs", () => ({ round: 10 }));
  try { console.log("SAID a", (await import("./a.mjs")).look()); } catch (e) { console.log("SAID a", e.name, String(e.message).slice(0, 90)); }
  try { console.log("SAID b", (await import("./b.mjs")).look()); } catch (e) { console.log("SAID b", e.name, String(e.message).slice(0, 90)); }
  try { console.log("SAID c", (await import("./c.mjs")).look()); } catch (e) { console.log("SAID c", e.name, String(e.message).slice(0, 90)); }
  try { console.log("SAID d", (await import("./d.mjs")).look()); } catch (e) { console.log("SAID d", e.name, String(e.message).slice(0, 90)); }
});

import { test, vi } from "bun:test";
test("the name is read off the namespace and imported", async () => {
  vi.doMock("./shapes.mjs", () => ({ spare: 2, round: "added" }));
  try { console.log("SAID whole", (await import("./whole.mjs")).look()); } catch (e) { console.log("SAID whole", e.name); }
  try { console.log("SAID named", (await import("./named.mjs")).look()); } catch (e) { console.log("SAID named", e.name); }
});

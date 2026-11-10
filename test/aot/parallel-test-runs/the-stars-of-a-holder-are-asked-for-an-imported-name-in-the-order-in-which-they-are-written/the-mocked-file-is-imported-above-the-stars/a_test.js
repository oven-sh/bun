import { test, vi } from "bun:test";
test("the name is imported", async () => {
  vi.doMock("./shapes.mjs", () => ({ round: 10 }));
  vi.doMock("./extra.mjs", () => ({ spare: 1, round: "added" }));
  try { console.log("SAID named", String((await import("./named.mjs")).look())); } catch (e) { console.log("SAID named", e.name); }
});

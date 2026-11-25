import { test, vi, jest, mock, afterAll, beforeAll } from "bun:test";
const read = (o, n) => { try { return String(o[n]); } catch { return "threw"; } };
const keys = o => Object.keys(o).sort().join("+");
const look = at => console.log("SAID", at, "| held", read(held, "who"), read(held, "other"), read(held, "more"), keys(held), "| by a name", heldUser(), "| the barrel", read(heldBarrel, "who"), read(heldBarrel, "other"), read(heldBarrel, "more"), keys(heldBarrel));
const ask = async at => { const asked = await import("./dep.js"); console.log("SAID", at, read(asked, "who"), read(asked, "other"), keys(asked), asked === held); };
const late = async at => console.log("SAID", at, (await import("./late.js")).viaLate());
test("t", async () => {
  mock.module("./dep.js", () => ({ who: "later", more: "later more" }));
  vi.doUnmock("./dep.js");
  mock.module("./dep.js", () => ({ who: "another" }));
  look("under another");
  await ask("asked under another");
  vi.doUnmock("./dep.js");
  look("behind its end");
});

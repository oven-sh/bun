import { test, vi, jest, mock, afterAll } from "bun:test";
const read = (o, n) => { try { return String(o[n]); } catch { return "threw"; } };
const keys = o => Object.keys(o).sort().join("+");
const look = at => console.log("SAID", at, "| held", read(held, "who"), read(held, "other"), read(held, "more"), keys(held), "| by a name", heldUser(), "| the barrel", read(heldBarrel, "who"), read(heldBarrel, "other"), read(heldBarrel, "more"), keys(heldBarrel));
test("t", async () => {
  mock.module("./dep.js", () => ({ who: "later", more: "later more" }));
  look("under the later mock");
  vi.doUnmock("./dep.js");
  look("behind its end");
  const asked = await import("./dep.js");
  console.log("SAID asked", read(asked, "who"), read(asked, "other"), keys(asked));
  look("behind the next load");
});

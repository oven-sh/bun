import { test, vi, jest } from "bun:test";
const say = (at, o, same) => { try { console.log("SAID", at, Object.keys(o).sort().join("+"), o.who, o.other, same === undefined ? "" : "the same object: " + same); } catch (e) { console.log("SAID", at, "threw", String(e.message).slice(0, 60)); } };
test("t", async () => {
  const held = require("./dep.cjs");
  say("first", held);
  vi.doMock("./dep.cjs", async importOriginal => { const o = await importOriginal(); say("the original", o, o === held); return { ...o, who: "later" }; });
  const now = await import("./dep.cjs");
  say("now", now, now === held);
  say("required now", require("./dep.cjs"));
  say("held", held);
});

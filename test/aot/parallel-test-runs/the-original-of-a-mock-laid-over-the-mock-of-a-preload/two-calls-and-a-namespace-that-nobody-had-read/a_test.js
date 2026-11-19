import { test, vi, jest, mock } from "bun:test";
import * as held from "./dep.js";
const say = (at, o, same) => { try { console.log("SAID", at, Object.keys(o).sort().join("+"), o.who, o.other, same === undefined ? "" : "the same object: " + same); } catch (e) { console.log("SAID", at, "threw", String(e.message).slice(0, 60)); } };
test("t", async () => {
  vi.doMock("./dep.js", async importOriginal => { globalThis.one = await importOriginal(); return { who: "never", other: "never" }; });
  vi.doMock("./dep.js", async importOriginal => { const o = await importOriginal(); say("the original", o, o === held); return { ...o, who: "later" }; });
  const now = await import("./dep.js");
  say("now", now, now === held);
  say("held", held);
  console.log("SAID the first factory ran:", "one" in globalThis);
});

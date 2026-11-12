import { test, vi, jest } from "bun:test";
const say = (at, o, same) => { try { console.log("SAID", at, Object.keys(o).sort().join("+"), o.who, o.other, same === undefined ? "" : "the same object: " + same); } catch (e) { console.log("SAID", at, "threw", String(e.message).slice(0, 60)); } };
test("t", async () => {
  const held = await import("./dep.cjs");
  say("first", held);
  vi.doMock("./dep.cjs", { spy: true });
  const now = await import("./dep.cjs");
  say("now", now, now === held);
  say("held", held);
});

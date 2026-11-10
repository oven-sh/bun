import { test, vi, jest } from "bun:test";
import * as held from "./dep.js";
const say = (at, o, same) => { try { console.log("SAID", at, Object.keys(o).sort().join("+"), o.who, o.other, same === undefined ? "" : "the same object: " + same); } catch (e) { console.log("SAID", at, "threw", String(e.message).slice(0, 60)); } };
test("t", async () => {
  say("first", held);
  vi.doMock("./dep.js", () => ({ who: "later", other: "later other" }));
  const now = await import("./dep.js");
  say("now", now, now === held);
  const o = await vi.importActual("./dep.js");
  say("the original", o, o === held);
  const r = jest.requireActual("./dep.js");
  say("required", r, r === held);
  say("held", held);
});

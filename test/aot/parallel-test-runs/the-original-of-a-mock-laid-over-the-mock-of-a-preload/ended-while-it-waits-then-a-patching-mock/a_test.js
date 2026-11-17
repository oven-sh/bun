import { test, vi, jest, mock } from "bun:test";
import * as held from "./dep.js";
const say = (at, o, same) => { try { console.log("SAID", at, Object.keys(o).sort().join("+"), o.who, o.other, same === undefined ? "" : "the same object: " + same); } catch (e) { console.log("SAID", at, "threw", String(e.message).slice(0, 60)); } };
test("t", async () => {
  say("first", held);
  vi.doMock("./dep.js", async importOriginal => ({ ...(await importOriginal()), who: "later" }));
  vi.doUnmock("./dep.js");
  mock.module("./dep.js", () => ({ who: "patched", other: "patched other" }));
  say("held", held);
  const now = await import("./dep.js");
  say("now", now, now === held);
});

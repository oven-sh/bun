import { test, vi, jest, mock } from "bun:test";
import * as top from "./dep.js";
vi.mock("./dep.js");
const say = (at, o, same) => { try { console.log("SAID", at, Object.keys(o).sort().join("+"), o.who, o.other, same === undefined ? "" : "the same object: " + same); } catch (e) { console.log("SAID", at, "threw", String(e.message).slice(0, 60)); } };
test("t", async () => {
  say("the top", top);
  for (const began = performance.now(); performance.now() - began < 30; );
  say("asked", await import("./dep.js"));
  console.log("SAID by a statement", (await import("./user.js")).viaUser());
  say("a namespace", (await import("./later.js")).look());
});

import { test, vi } from "bun:test";
import * as top from "./dep.js";
const say = (at, what) => console.log("SAID", at, what.who, what.other, Object.keys(what).sort().join("+"));
test("t", async () => {
  say("the top", top);
  vi.doMock("./dep.js");
  // Whatever takes time between the call and the next importer, a collection for one.
  for (const began = performance.now(); performance.now() - began < 50; );
  say("asked", await import("./dep.js"));
  say("by a statement", { who: (await import("./user.js")).viaUser() });
  say("a namespace", (await import("./later.js")).look());
});

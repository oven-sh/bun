import { test, vi, mock } from "bun:test";
const say = (at, what) => console.log("SAID", at, what.who, what.other, Object.keys(what).sort().join("+"));
const wait = () => { for (const began = performance.now(); performance.now() - began < 50; ); };
import top from "./data.json";
test("t", async () => {
  say("the top", top);
  vi.doMock("./data.json");
  wait();
  say("asked", (await import("./data.json")).default);
  say("by a statement", { who: (await import("./user.js")).viaUser() });
});

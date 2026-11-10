import { test, vi } from "bun:test";
const keys = space => Object.keys(space).sort().join();
const say = (...words) => console.log("SAID", ...words, globalThis.runs ?? 0);
test("one", async () => {
  vi.doMock("./gauge.mjs", () => ({ lent: 2 }));
  say("under", keys(await import("./hall.js")));
  vi.doUnmock("./gauge.mjs");
  say("behind", keys(await import("./hall.js")));
  say("the old barrel", keys(await import("./porch.js")));
});

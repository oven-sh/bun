import { test, vi } from "bun:test";
const attempt = run => { try { return run(); } catch (error) { return error.name; } };
const turn = () => new Promise(done => setImmediate(done));
test("a", async () => {
  vi.doMock("./reel.mjs", async () => { await 0; return { turns: "mock" }; });
  console.log("SAID 1", attempt(() => import.meta.require("./reel.mjs").turns));
  await turn();
  console.log("SAID 2", attempt(() => import.meta.require("./reel.mjs").turns));
  await turn();
  console.log("SAID 3", (await import("./reel.mjs")).turns);
});

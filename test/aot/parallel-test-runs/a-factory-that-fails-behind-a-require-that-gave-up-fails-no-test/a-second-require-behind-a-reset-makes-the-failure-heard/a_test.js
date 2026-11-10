import { test, vi } from "bun:test";
const later = () => new Promise(done => setTimeout(done, 5));
const tried = () => { try { return require("./lamp.mjs").seen; } catch (error) { return error.constructor.name; } };
test("a", async () => {
  vi.doMock("./wick.mjs", async () => { await later(); throw new RangeError("the factory fails"); });
  console.log(tried());
  vi.resetModules();
  console.log(tried());
  for (let turn = 0; turn < 6; turn++) await later();
  console.log("the end");
});

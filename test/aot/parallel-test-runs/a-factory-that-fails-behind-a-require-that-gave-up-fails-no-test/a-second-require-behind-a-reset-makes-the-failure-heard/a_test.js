import { test, vi } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
const gate = Promise.withResolvers();
const tried = () => { try { return require("./lamp.mjs").seen; } catch (error) { return error.constructor.name; } };
test("a", async () => {
  vi.doMock("./wick.mjs", async () => { await gate.promise; throw new RangeError("the factory fails"); });
  console.log(tried());
  vi.resetModules();
  console.log(tried());
  gate.resolve();
  await spinEventLoop();
  console.log("the end");
});

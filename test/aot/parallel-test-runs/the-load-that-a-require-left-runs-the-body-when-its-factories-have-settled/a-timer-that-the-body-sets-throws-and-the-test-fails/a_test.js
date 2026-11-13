import { test, vi } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
const gate = Promise.withResolvers(), timer = Promise.withResolvers();
globalThis.timerFires = timer.resolve;
const asked = name => { try { return String(require(name).seen); } catch { return "threw"; } };
test("a", async () => {
  vi.doMock("./wick.mjs", async () => { await gate.promise; return { width: "mocked" }; });
  console.log(asked("./lamp.mjs"));
  gate.resolve();
  await timer.promise;
  await spinEventLoop();
  console.log("the end", globalThis.bodies ?? 0);
});

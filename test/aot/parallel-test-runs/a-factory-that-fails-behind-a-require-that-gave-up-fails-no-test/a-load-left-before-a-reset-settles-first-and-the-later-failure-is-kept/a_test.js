import { test, vi } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
const firstGate = Promise.withResolvers(), secondGate = Promise.withResolvers();
const tried = name => { try { require(name); return "answered"; } catch { return "threw"; } };
let calls = 0;
test("a", async () => {
  vi.doMock("./wick.mjs", async () => { await firstGate.promise; return { width: "mocked" }; });
  console.log(tried("./lamp.mjs"));
  vi.resetModules();
  vi.doMock("./oil.mjs", async () => { calls++; await secondGate.promise; throw new Error("oil fails " + calls); });
  console.log(tried("./flask.mjs"));
  firstGate.resolve();
  await spinEventLoop();
  secondGate.resolve();
  await spinEventLoop();
  console.log(await import("./flask.mjs").then(it => it.seen, error => error.message), calls);
});

import { test, vi } from "bun:test";
let wicks = 0, oils = 0;
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
const gate = Promise.withResolvers();
const asked = name => { try { return String(require(name).seen); } catch { return "threw"; } };
const never = () => new Promise(() => {});
test("a", async () => {
  vi.doMock("./wick.mjs", async () => { wicks++; await never(); });
  console.log(asked("./lamp.mjs"));
  vi.doMock("./wick.mjs", async () => { wicks++; await gate.promise; throw new RangeError("the later factory fails"); });
  console.log(asked("./shelf.mjs"));
  gate.resolve();
  await spinEventLoop();
  console.log("the end", wicks, oils);
});

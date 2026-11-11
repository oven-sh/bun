import { test, vi } from "bun:test";
let calls = 0;
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
const gate = Promise.withResolvers();
const asked = name => { try { return String(require(name).seen); } catch { return "threw"; } };
test("a", async () => {
  vi.doMock("./wick.mjs", async () => { calls++; await gate.promise; return { width: "mocked " + calls }; });
  console.log(asked("./shelf.mjs"));
  console.log(asked("./lamp.mjs"));
  gate.resolve();
  await spinEventLoop();
  console.log(asked("./lamp.mjs"), "|", asked("./shelf.mjs"), "|", calls);
});

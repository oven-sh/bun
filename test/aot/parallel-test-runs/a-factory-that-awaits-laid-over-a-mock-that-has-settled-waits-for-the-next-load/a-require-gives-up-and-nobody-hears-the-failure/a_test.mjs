import { test, vi } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
let open;
const gate = new Promise(done => (open = done));
let calls = 0;
test("t", async () => {
  vi.doMock("./thread.mjs", () => ({ width: "mock " + ++calls }));
  console.log("SAID spool", require("./spool.mjs").seen);
  vi.doMock("./thread.mjs", async () => {
    const call = ++calls;
    await gate;
    throw new Error("call " + call);
  });
  console.log("SAID calls behind the laying", calls);
  let reel;
  try {
    reel = require("./reel.mjs").seen;
  } catch (error) {
    reel = "threw " + error.name;
  }
  console.log("SAID reel", reel);
  open();
  await spinEventLoop();
  console.log("SAID calls", calls);
});

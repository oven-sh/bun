import { test, vi } from "bun:test";
import { byHelper } from "./helper.mjs";
const byTest = name => { try { return require(name).seen; } catch (error) { return "threw " + error.name; } };
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
let calls = 0;
test("a mocked file of the old kind", async () => {
  vi.doMock("./pump.cjs", async () => { calls++; await spinEventLoop(1); return { seen: "fake " + calls }; });
  console.log("SAID 1 " + (await import("./tank.mjs").then(names => names.seen, error => "rejected " + error.name)));
  await spinEventLoop();
  console.log("SAID calls " + calls);
}, 8000);

import { test, vi } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
const ask = async () => { try { return typeof (await import("pkg")).go; } catch (error) { return error.name; } };
const now = () => { try { return typeof require("pkg").go; } catch (error) { return error.name; } };
test("a", async () => {
  const said = [];
  vi.doMock("pkg");
  said.push(await ask());
  said.push(now());
  console.log("SAID a", said.join(), globalThis.bodies);
  // The runner hears of the rejection when the jobs have run out. The test lasts until then, so that it is this test that fails.
  await spinEventLoop();
});
test("b", () => { console.log("SAID b runs"); });

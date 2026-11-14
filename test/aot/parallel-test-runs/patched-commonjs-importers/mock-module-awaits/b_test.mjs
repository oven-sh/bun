import { jest, mock, test, vi } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
test("b", async () => {
  mock.module("./tax.cjs", async () => { await 0; return { rate: 9, fee: () => 9 }; });
  console.log("SAID b", (await import("./sale.mjs")).sold());
  await spinEventLoop();
  console.log("SAID later", (await import("./sale.mjs")).sold());
});

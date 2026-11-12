import { jest, mock, test, vi } from "bun:test";
import { sold } from "./sale.mjs";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
vi.mock("./tax.cjs", async () => { await 0; return { rate: 9, fee: () => 9 }; });
test("b", async () => {
  console.log("SAID b", sold());
  await spinEventLoop();
  console.log("SAID later", sold());
});

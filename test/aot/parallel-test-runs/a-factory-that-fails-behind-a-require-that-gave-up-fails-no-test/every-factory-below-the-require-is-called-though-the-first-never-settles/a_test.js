import { test, vi } from "bun:test";
let wicks = 0, oils = 0;
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
const asked = name => { try { return String(require(name).seen); } catch { return "threw"; } };
const never = () => new Promise(() => {});
test("a", async () => {
  vi.doMock("./wick.mjs", async () => { wicks++; await never(); });
  vi.doMock("./oil.mjs", async () => { oils++; await never(); });
  console.log(asked("./pair.mjs"), wicks, oils);
  await spinEventLoop();
  console.log("the end", wicks, oils);
});

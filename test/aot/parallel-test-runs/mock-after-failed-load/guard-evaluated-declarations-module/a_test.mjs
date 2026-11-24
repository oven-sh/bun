import { expect, jest, test, vi } from "bun:test";
import { use } from "./user.mjs";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
test("at once", () => {
  console.log("SAID", use());
  jest.doMock("./util.mjs");
  console.log("SAID", use());
});
test("later", async () => {
  await spinEventLoop();
  console.log("SAID", use());
});

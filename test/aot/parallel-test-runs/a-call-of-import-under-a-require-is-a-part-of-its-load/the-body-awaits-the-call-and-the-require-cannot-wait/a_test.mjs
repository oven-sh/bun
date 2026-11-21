import { test } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
test("the loom is imported", async () => {
  await import("./loom.mjs").then(it => console.log("came", it.loom), error => console.log("failed", error.name));
  await spinEventLoop();
});

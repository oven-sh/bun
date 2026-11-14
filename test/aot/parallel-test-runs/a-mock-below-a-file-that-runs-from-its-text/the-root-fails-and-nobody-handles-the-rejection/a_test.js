// Nobody handles the rejection of this import(): the test fails, compiled too.
import { test, vi } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
Bun.plugin({ name: "served", setup(build) { build.onLoad({ filter: /served\.js$/ }, async () => { await 0; return { contents: 'export const served = "served";', loader: "js" }; }); } });
test("x", async () => {
  console.log("SAID the test begins");
  globalThis.reached = Promise.withResolvers();
  vi.doMock("./k.js", () => ({ x: "mock" }));
  import("./fails.js");
  await globalThis.reached.promise;
  await spinEventLoop();
  console.log("SAID the test goes on");
});

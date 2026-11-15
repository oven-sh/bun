import { jest, test, vi } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
test("the second pass finds nothing loaded", async () => {
  jest.doMock("./lib.mjs", async original => {
    console.log("the factory is called");
    return { ...(await original()), a: "first" };
  });
  await spinEventLoop();
  console.log("mocked");
  vi.doMock("./lib.mjs", () => ({ a: "second" }));
  vi.doUnmock("./lib.mjs");
  console.log("runs", globalThis.runs);
});

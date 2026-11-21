import { test, vi } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
const firstGate = Promise.withResolvers(), secondGate = Promise.withResolvers();
const asked = load => {
  try {
    return String(load().seen);
  } catch (error) {
    return "threw " + error.name;
  }
};
test("t", async () => {
  vi.doMock("./thread.mjs", () => new Promise(() => {}));
  console.log(
    "SAID spool",
    asked(() => require("./spool.mjs")),
  );
  vi.doMock("./thread.mjs", async () => {
    await firstGate.promise;
    return { width: "mocked" };
  });
  console.log(
    "SAID reel",
    asked(() => require("./reel.mjs")),
  );
  firstGate.resolve();
  await spinEventLoop();
  vi.doMock("./thread.mjs", async () => {
    await secondGate.promise;
    throw new Error("the third factory");
  });
  console.log(
    "SAID spool again",
    asked(() => require("./spool.mjs")),
  );
  secondGate.resolve();
  await spinEventLoop();
  console.log("SAID the end");
});

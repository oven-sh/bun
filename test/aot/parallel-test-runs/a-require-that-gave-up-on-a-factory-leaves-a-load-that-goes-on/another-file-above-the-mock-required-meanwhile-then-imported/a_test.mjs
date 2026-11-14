import { test, vi } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
const gate = Promise.withResolvers();
const asked = load => {
  try {
    return String(load().seen);
  } catch (error) {
    return "threw " + error.name;
  }
};
test("t", async () => {
  vi.doMock("./thread.mjs", async () => {
    await gate.promise;
    return { width: "mocked" };
  });
  console.log(
    "SAID spool",
    asked(() => require("./spool.mjs")),
  );
  vi.resetModules();
  console.log(
    "SAID reel meanwhile",
    asked(() => require("./reel.mjs")),
  );
  gate.resolve();
  await spinEventLoop();
  console.log(
    "SAID reel",
    await import("./reel.mjs").then(
      it => it.seen,
      () => "rejected",
    ),
  );
});

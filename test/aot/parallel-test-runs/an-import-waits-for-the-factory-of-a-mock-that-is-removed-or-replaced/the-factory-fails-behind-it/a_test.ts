import { test, vi } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
test("fails", async () => {
  const called = Promise.withResolvers<void>();
  const settles = Promise.withResolvers<{ x: string }>();
  vi.doMock("./kept", () => (called.resolve(), settles.promise));
  const importing = import("./user");
  await called.promise;
  vi.doUnmock("./kept");
  console.log("SAID", (await import("./kept")).x, (await importing).x);
  settles.promise.catch(() => {}); settles.reject(new Error("late"));
  await spinEventLoop();
  console.log("SAID", (await import("./kept")).x, (await import("./user")).x);
});

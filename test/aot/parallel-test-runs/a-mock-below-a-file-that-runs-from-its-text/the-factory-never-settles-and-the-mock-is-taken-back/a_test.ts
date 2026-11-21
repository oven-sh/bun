// The fetch that waits for the factory is let go when the mock is taken back.
import { test, vi } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
const asked = Promise.withResolvers<void>(), gate = Promise.withResolvers<void>(), called = Promise.withResolvers<void>();
Bun.plugin({
  name: "slow",
  setup(build) {
    build.onLoad({ filter: /slow\.ts$/ }, async () => {
      console.log("the plugin is asked");
      asked.resolve();
      await gate.promise;
      console.log("the plugin answers");
      return { contents: 'export const pace = "slow";', loader: "ts" };
    });
  },
});
test("a", async () => {
  vi.doMock("./tax", () => { console.log("factory runs"); called.resolve(); return new Promise(() => {}); });
  const reader = import("./reader");
  await asked.promise;
  gate.resolve();
  await called.promise;
  await spinEventLoop();
  vi.doUnmock("./tax");
  console.log("a", (await import("./tax")).rate, (await reader).read);
});

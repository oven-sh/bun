// The call used to wait for ever: the factory ran at the call, and the plugin was never asked.
import { test, vi } from "bun:test";
const asked = Promise.withResolvers<void>(), gate = Promise.withResolvers<void>();
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
  let calls = 0;
  vi.doMock("./tax", async () => { calls++; console.log("factory runs"); await 0; throw new Error("the factory failed"); });
  const reader = import("./reader").then(it => it.read, error => "threw " + error.message);
  await asked.promise;
  gate.resolve();
  console.log("a", await reader, calls);
});

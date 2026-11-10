// The factory runs inside the fetch of tax, behind its turn. What it imports of tax is the module itself.
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
  vi.doMock("./tax", async () => { console.log("factory runs"); return { ...(await import("./tax")), rate: "mock rate" }; });
  const reader = import("./reader");
  await asked.promise;
  gate.resolve();
  console.log("a", (await reader).read);
});

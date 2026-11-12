// The fetch that waits for the factory is let go when the mock is taken back.
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
  vi.doMock("./tax", () => { console.log("factory runs"); return new Promise(() => {}); });
  const reader = import("./reader");
  await asked.promise;
  gate.resolve();
  await new Promise(resolve => setTimeout(resolve, 30));
  vi.doUnmock("./tax");
  console.log("a", (await import("./tax")).rate, (await reader).read);
});

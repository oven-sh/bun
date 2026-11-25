// As test/aot/unmock-while-loading.test.ts, with a CommonJS file.
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
  vi.doMock("./tax.cjs", () => { console.log("factory runs"); return { rate: "mock rate" }; });
  const reader = import("./reader");
  await asked.promise;
  vi.doUnmock("./tax.cjs");
  gate.resolve();
  console.log("a", (await reader).read);
});

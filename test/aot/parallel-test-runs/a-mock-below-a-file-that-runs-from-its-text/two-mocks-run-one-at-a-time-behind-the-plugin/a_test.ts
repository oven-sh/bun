// A plugin serves an import of reader, so reader runs from its text. The factories below it run once the load has fetched all it can without them, one at a time, in the order of the imports.
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
  vi.doMock("./tax", async () => { console.log("factory of tax"); await 0; await 0; console.log("factory of tax ends"); return { rate: "mock rate" }; });
  vi.doMock("./fee", async () => { console.log("factory of fee"); await 0; console.log("factory of fee ends"); return { fee: "mock fee" }; });
  const reader = import("./reader");
  await asked.promise;
  gate.resolve();
  console.log("a", (await reader).read);
});

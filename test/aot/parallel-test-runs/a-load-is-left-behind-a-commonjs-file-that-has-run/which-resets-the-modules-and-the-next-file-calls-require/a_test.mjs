import { test, vi } from "bun:test";
const spinEventLoop = async () => {
  for (let turn = 0; turn < 20; turn++) await new Promise(setImmediate);
};
test("a", async () => {
  const called = Promise.withResolvers();
  vi.doMock("./never.mjs", () => (called.resolve(), new Promise(() => {})));
  globalThis.hook = () => {
    globalThis.hook = undefined;
    vi.resetModules();
  };
  import("./root.mjs").then(() => console.log("loaded"), error => console.log("failed", error.name));
  await called.promise;
  await spinEventLoop();
  console.log("a ends");
});

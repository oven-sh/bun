import { test, vi } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
test("b", async () => {
  const waits = Promise.withResolvers();
  vi.doMock("./lib.mjs", async original => {
    const real = await original();
    waits.resolve();
    await globalThis.fromBelow;
    return { ...real, extra: "more" };
  });
  console.log("SAID the test imports the file");
  const lib = import("./lib.mjs").then(lib => "has " + Object.keys(lib).sort().join());
  await waits.promise;
  // The factory waits for the import of its dependency, and that import for the factory. Nothing can say that it stays so.
  console.log("SAID the test " + (await Promise.race([lib, spinEventLoop(100).then(() => "waits")])));
});

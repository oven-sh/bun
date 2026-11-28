import { test, vi } from "bun:test";
const keys = it => Object.keys(it).sort().join();
test("b", async () => {
  // The factory of warp.mjs opens it where it has its original and still runs: the outer factory asks again there, whenever the texts arrive.
  const hasOriginal = Promise.withResolvers();
  vi.doMock("./warp.mjs", async () => {
    const real = await vi.importActual("./warp.mjs");
    hasOriginal.resolve();
    for (let turn = 0; turn < 3; turn++) await new Promise(done => setImmediate(done));
    return { ...real, extra: "more" };
  });
  vi.doMock("./weft.mjs", async () => {
    const first = import("./warp.mjs");
    await hasOriginal.promise;
    const second = import("./warp.mjs");
    const [one, two] = await Promise.all([first, second]);
    console.log("SAID the outer has one object " + (one === two) + " | " + keys(one) + " | " + keys(two));
    globalThis.one = one; globalThis.two = two;
    return { weft: "mock weft" };
  });
  await import("./weft.mjs");
  const later = await import("./warp.mjs");
  console.log("SAID later is " + (later === globalThis.one ? "the first" : later === globalThis.two ? "the second" : "a third") + " | " + keys(later));
});

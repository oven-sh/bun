import { test, vi } from "bun:test";
const keys = it => Object.keys(it).sort().join();
test("b", async () => {
  vi.doMock("./warp.mjs", async () => {
    for (let turn = 0; turn < 3; turn++) await new Promise(done => setImmediate(done));
    return { warp: "mock warp", extra: "more" };
  });
  vi.doMock("./weft.mjs", async () => {
    const [one, two] = await Promise.all([import("./warp.mjs"), import("./warp.mjs")]);
    console.log("SAID the outer has one object " + (one === two) + " | " + keys(one) + " | " + keys(two));
    globalThis.one = one; globalThis.two = two;
    return { weft: "mock weft" };
  });
  await import("./weft.mjs");
  const later = await import("./warp.mjs");
  console.log("SAID later is " + (later === globalThis.one ? "the first" : later === globalThis.two ? "the second" : "a third") + " | " + keys(later));
}, 4000);

import { test, vi } from "bun:test";
test("b", async () => {
  vi.doMock("./warp.mjs", () => ({ warp: "mock warp", knot: "mock knot" }));
  vi.doMock("./weft.mjs", async () => {
    const real = await vi.importActual("./warp.mjs");
    let found = "nothing";
    globalThis.fromBelow.then(it => {
      found = Object.keys(it).sort().join();
    });
    for (let turn = 0; turn < 3; turn++) await new Promise(done => setImmediate(done));
    console.log("SAID the factory finds " + found);
    return { weft: "mock weft with " + real.warp };
  });
  const weft = await import("./weft.mjs");
  console.log("SAID the test has " + weft.weft);
  console.log("SAID the file below has " + Object.keys(await globalThis.fromBelow).sort().join() + " " + (await globalThis.fromBelow).warp);
}, 4000);

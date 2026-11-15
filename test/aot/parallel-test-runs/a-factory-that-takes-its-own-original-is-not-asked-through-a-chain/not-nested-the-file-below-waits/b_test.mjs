import { test, vi } from "bun:test";
test("b", async () => {
  vi.doMock("./warp.mjs", async () => {
    const real = await vi.importActual("./warp.mjs");
    let found = "nothing";
    globalThis.fromBelow.then(it => {
      found = Object.keys(it).sort().join();
    });
    for (let turn = 0; turn < 3; turn++) await new Promise(done => setImmediate(done));
    console.log("SAID the factory finds " + found);
    return { ...real, extra: "more" };
  });
  const warp = await import("./warp.mjs");
  console.log("SAID the test has " + Object.keys(warp).sort().join());
  console.log("SAID the file below has " + Object.keys(await globalThis.fromBelow).sort().join());
}, 4000);

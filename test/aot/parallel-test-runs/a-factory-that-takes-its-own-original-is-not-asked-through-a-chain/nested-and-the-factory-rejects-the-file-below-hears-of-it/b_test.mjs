import { test, vi } from "bun:test";
test("b", async () => {
  vi.doMock("./warp.mjs", async () => {
    const real = await vi.importActual("./warp.mjs");
    let found = "nothing";
    globalThis.fromBelow.then(it => {
      found = Object.keys(it).sort().join();
    }, () => {});
    for (let turn = 0; turn < 3; turn++) await new Promise(done => setImmediate(done));
    console.log("SAID the factory finds " + found);
    throw new RangeError("warp refuses");
  });
  vi.doMock("./weft.mjs", async () => {
    const warp = await import("./warp.mjs").catch(error => ({ ["failed " + error.name]: 1 }));
    return { weft: "mock weft over " + Object.keys(warp).sort().join() };
  });
  const weft = await import("./weft.mjs");
  console.log("SAID the test has " + weft.weft);
  console.log("SAID the file below has " + (await globalThis.fromBelow.then(it => Object.keys(it).sort().join(), error => "failed " + error.name)));
}, 4000);

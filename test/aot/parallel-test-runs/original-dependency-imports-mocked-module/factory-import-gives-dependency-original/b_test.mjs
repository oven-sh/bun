import { test, vi } from "bun:test";
test("b", async () => {
  vi.doMock("./lib.mjs", async () => {
    const real = await import("./lib.mjs");
    let found = "nothing";
    globalThis.fromBelow.then(it => {
      found = Object.keys(it).sort().join();
    });
    for (let turn = 0; turn < 3; turn++) await new Promise(done => setImmediate(done));
    console.log("SAID the factory finds " + found);
    return { ...real, extra: "more" };
  });
  console.log("SAID the test imports the file");
  const lib = await import("./lib.mjs");
  console.log("SAID the test has " + Object.keys(lib).sort().join());
  const fromBelow = await globalThis.fromBelow;
  console.log("SAID the file below has " + Object.keys(fromBelow).sort().join() + ", the same " + (lib === fromBelow));
}, 4000);

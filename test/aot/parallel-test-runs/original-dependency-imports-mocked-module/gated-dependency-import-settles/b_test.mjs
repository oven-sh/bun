import { test, vi } from "bun:test";
test("b", async () => {
  globalThis.gate = new Promise(done => {
    globalThis.open = done;
  });
  vi.doMock("./lib.mjs", async original => ({ ...(await original()), extra: "more" }));
  console.log("SAID the test imports the file");
  const call = import("./lib.mjs");
  globalThis.open();
  const lib = await call;
  console.log("SAID the test has " + Object.keys(lib).sort().join());
}, 4000);

import { test, vi } from "bun:test";
const turns = async () => {
  for (let turn = 0; turn < 3; turn++) await new Promise(done => setImmediate(done));
};
test("b", async () => {
  globalThis.gateOne = new Promise(done => {
    globalThis.openOne = done;
  });
  globalThis.gateTwo = new Promise(done => {
    globalThis.openTwo = done;
  });
  vi.doMock("./lib.mjs", async () => ({ ...(await vi.importActual("./lib.mjs")), extra: "more" }));
  console.log("SAID the test imports the file");
  const call = import("./lib.mjs");
  await turns();
  console.log("SAID the first gate opens");
  globalThis.openOne();
  await turns();
  console.log("SAID the second gate opens");
  globalThis.openTwo();
  const lib = await call;
  console.log("SAID the test has " + Object.keys(lib).sort().join());
  await turns();
  console.log("SAID the test ends");
}, 4000);

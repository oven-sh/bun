import { test, vi } from "bun:test";
import { byHelper } from "./helper.mjs";
const gate = Promise.withResolvers(), settles = Promise.withResolvers();
let hasBegun = false;
const settled = async () => {
  gate.resolve();
  if (hasBegun) await settles.promise;
  await new Promise(done => setImmediate(done));
};
test("what is reported", async () => {
  vi.doMock("./pump.mjs", async () => { hasBegun = true; await gate.promise; settles.resolve(); throw new Error("no pump"); });
  console.log("SAID 1 " + byHelper("./tank.mjs"));
  console.log("SAID 2 " + byHelper("./gauge.mjs"));
  await settled();
  console.log("SAID the test goes on to its end");
}, 8000);

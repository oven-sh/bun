import { test, vi } from "bun:test";
import { byHelper } from "./helper.mjs";
import { byOther } from "./other.mjs";
const gate = Promise.withResolvers(), settles = Promise.withResolvers();
let hasBegun = false;
const settled = async () => {
  gate.resolve();
  if (hasBegun) await settles.promise;
  await new Promise(done => setImmediate(done));
};
const ask = name => { try { return require(name).seen; } catch (error) { return "threw " + error.name; } };
test("who is given what", async () => {
  vi.doMock("./pump.mjs", async () => { hasBegun = true; await gate.promise; settles.resolve(); return { flow: "stand-in" }; });
  console.log("SAID first " + byHelper("./tank.mjs"));
  console.log("SAID second " + ask("./gauge.mjs"));
  await settled();
  console.log("SAID at last " + (await import("./pump.mjs")).flow);
}, 8000);

import { test, vi } from "bun:test";
import { byHelper, layMock } from "./helper.mjs";
import { byOther } from "./other.mjs";
globalThis.gate = Promise.withResolvers();
globalThis.settles = Promise.withResolvers();
globalThis.hasBegun = false;
const settled = async () => {
  globalThis.gate.resolve();
  if (globalThis.hasBegun) await globalThis.settles.promise;
  await new Promise(done => setImmediate(done));
};
const ask = name => { try { return require(name).seen; } catch (error) { return "threw " + error.name; } };
test("who is given what", async () => {
  layMock();
  console.log("SAID first " + ask("./tank.mjs"));
  console.log("SAID second " + ask("./gauge.mjs"));
  await settled();
  console.log("SAID at last " + (await import("./pump.mjs")).flow);
}, 8000);

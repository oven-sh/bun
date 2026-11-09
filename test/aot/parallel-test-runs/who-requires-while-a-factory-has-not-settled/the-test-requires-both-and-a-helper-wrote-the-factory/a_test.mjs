import { test, vi } from "bun:test";
import { byHelper, layMock } from "./helper.mjs";
import { byOther } from "./other.mjs";
const rest = time => new Promise(done => setTimeout(done, time));
const ask = name => { try { return require(name).seen; } catch (error) { return "threw " + error.name; } };
test("who is given what", async () => {
  layMock();
  console.log("SAID first " + ask("./tank.mjs"));
  console.log("SAID second " + ask("./gauge.mjs"));
  await rest(40);
  console.log("SAID at last " + (await import("./pump.mjs")).flow);
}, 8000);

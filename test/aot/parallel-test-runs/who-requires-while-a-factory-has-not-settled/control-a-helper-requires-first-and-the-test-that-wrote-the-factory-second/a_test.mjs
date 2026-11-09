import { test, vi } from "bun:test";
import { byHelper } from "./helper.mjs";
import { byOther } from "./other.mjs";
const rest = time => new Promise(done => setTimeout(done, time));
const ask = name => { try { return require(name).seen; } catch (error) { return "threw " + error.name; } };
test("who is given what", async () => {
  vi.doMock("./pump.mjs", async () => { await rest(10); return { flow: "stand-in" }; });
  console.log("SAID first " + byHelper("./tank.mjs"));
  console.log("SAID second " + ask("./gauge.mjs"));
  await rest(40);
  console.log("SAID at last " + (await import("./pump.mjs")).flow);
}, 8000);

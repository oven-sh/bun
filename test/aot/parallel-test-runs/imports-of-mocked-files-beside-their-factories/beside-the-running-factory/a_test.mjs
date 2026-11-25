import { test, vi } from "bun:test";
import * as helper from "./helper.mjs";
const turnsUntil = async promise => { let settled = false; promise.then(() => { settled = true; }, () => { settled = true; }); let turns = 0; while (!settled && turns < 400) { await new Promise(done => setImmediate(done)); turns++; } return turns; };
test("it gets the original", async () => {
  const begun = new Promise(done => {
    globalThis.begun = done;
  });
  vi.doMock("./second.mjs", async () => {
    const one = await import("./first.mjs");
    globalThis.begun(one.name);
    await helper.gateOfSecond;
    throw new RangeError("second refuses");
  });
  const second = import("./second.mjs");
  await begun;
  helper.openFirst();
  second.catch(() => {});
  console.log("SAID turns", await turnsUntil(globalThis.other()));
  helper.openSecond();
}, 5000);

import { test, vi } from "bun:test";
import { byHelper } from "./helper.mjs";
const rest = time => new Promise(done => setTimeout(done, time));
test("what is reported", async () => {
  vi.doMock("./pump.mjs", async () => { await rest(10); throw new Error("no pump"); });
  console.log("SAID 1 " + byHelper("./tank.mjs"));
  console.log("SAID 2 " + byHelper("./gauge.mjs"));
  console.log("SAID 3 " + byHelper("./dial.mjs"));
  await rest(40);
  console.log("SAID the test goes on to its end");
}, 8000);

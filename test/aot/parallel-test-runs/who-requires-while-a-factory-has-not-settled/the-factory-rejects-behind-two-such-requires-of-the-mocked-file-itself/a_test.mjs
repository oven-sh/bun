import { test, vi } from "bun:test";
import { byHelper } from "./helper.mjs";
const byTest = name => { try { return require(name).seen; } catch (error) { return "threw " + error.name; } };
const rest = time => new Promise(done => setTimeout(done, time));
test("what is reported", async () => {
  vi.doMock("./pump.mjs", async () => { await rest(10); throw new Error("no pump"); });
  console.log("SAID 1 " + byHelper("./tank.mjs"));
  console.log("SAID 2 " + byHelper("./pump.mjs"));
  console.log("SAID 3 " + byHelper("./pump.mjs"));
  await rest(40);
  console.log("SAID the test goes on to its end");
}, 8000);

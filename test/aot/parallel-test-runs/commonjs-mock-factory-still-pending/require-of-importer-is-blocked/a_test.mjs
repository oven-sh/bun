import { test, vi } from "bun:test";
import { byHelper } from "./helper.mjs";
const byTest = name => { try { return require(name).seen; } catch (error) { return "threw " + error.name; } };
const rest = time => new Promise(done => setTimeout(done, time));
let calls = 0;
test("a mocked file of the old kind", async () => {
  vi.doMock("./pump.cjs", async () => { calls++; await rest(10); return { seen: "fake " + calls }; });
  console.log("SAID 1 " + byTest("./tank.mjs"));
  await rest(40);
  console.log("SAID calls " + calls);
}, 8000);

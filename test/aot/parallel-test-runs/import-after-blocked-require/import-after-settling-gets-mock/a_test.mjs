import { test, vi } from "bun:test";
import { requireH, importH } from "./helper.mjs";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
const requireT = name => { try { return require(name).seen; } catch (error) { return "threw " + error.name; } };
const importT = async name => { try { return (await import(name)).seen; } catch (error) { return "rejected " + error.name; } };
let calls = 0;
const gate = Promise.withResolvers();
test("an import behind a require that was refused", async () => {
  vi.doMock("./pump.mjs", async () => { calls++; await gate.promise; return { seen: "fake " + calls }; });
  console.log("SAID 1 " + requireT("./tank.mjs"));
  console.log("SAID 2 " + (await importT("./tank.mjs")));
  gate.resolve();
  await spinEventLoop();
  console.log("SAID 3 " + (await importT("./tank.mjs")));
  gate.resolve();
  console.log("SAID calls " + calls);
}, 8000);

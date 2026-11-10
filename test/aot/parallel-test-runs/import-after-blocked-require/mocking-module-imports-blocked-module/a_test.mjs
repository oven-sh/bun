import { test, vi } from "bun:test";
import { requireH, importH } from "./helper.mjs";
const restT = time => new Promise(done => setTimeout(done, time));
const requireT = name => { try { return require(name).seen; } catch (error) { return "threw " + error.name; } };
const importT = async name => { try { const names = await Promise.race([import(name), restT(400)]); return names === undefined ? "waits" : names.seen; } catch (error) { return "rejected " + error.name; } };
let calls = 0;
const gate = Promise.withResolvers();
test("an import behind a require that was refused", async () => {
  vi.doMock("./pump.mjs", async () => { calls++; await gate.promise; return { seen: "fake " + calls }; });
  console.log("SAID 1 " + requireT("./tank.mjs"));
  console.log("SAID 2 " + (await importT("./tank.mjs")));
  gate.resolve();
  console.log("SAID calls " + calls);
}, 8000);

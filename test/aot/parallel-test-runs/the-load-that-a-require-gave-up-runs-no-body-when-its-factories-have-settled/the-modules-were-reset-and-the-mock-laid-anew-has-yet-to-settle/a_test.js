import { test, vi } from "bun:test";
const turns = async count => { for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done)); };
const asked = name => { try { return String(require(name).seen); } catch { return "threw"; } };
let openOld, openFresh;
const oldGate = new Promise(open => { openOld = open; });
const freshGate = new Promise(open => { openFresh = open; });
test("a", async () => {
  vi.doMock("./wick.mjs", async () => { await oldGate; return { width: "old" }; });
  console.log(asked("./lamp.mjs"));
  vi.resetModules();
  vi.doMock("./wick.mjs", async () => { await freshGate; return { width: "fresh" }; });
  console.log(asked("./lamp.mjs"));
  openOld();
  await turns(5);
  openFresh();
  await turns(5);
  console.log(asked("./lamp.mjs"));
});

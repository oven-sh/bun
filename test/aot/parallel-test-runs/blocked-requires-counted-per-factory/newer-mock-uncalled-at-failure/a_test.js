import { test, vi } from "bun:test";
const turns = async count => { for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done)); };
const asked = name => { try { return String(require(name).seen); } catch { return "threw"; } };
let openOil, openWick;
const never = new Promise(() => {});
const oilGate = new Promise(open => { openOil = open; });
const wickGate = new Promise(open => { openWick = open; });
test("a", async () => {
  vi.doMock("./wick.mjs", async () => { await never; });
  console.log(asked("./lamp.mjs"));
  vi.doMock("./wick.mjs", async () => { await wickGate; throw new RangeError("wick fails"); });
  console.log(asked("./pair.mjs"));
  vi.doMock("./wick.mjs", () => ({ width: "anew" }));
  openWick();
  await turns(5);
  console.log("the end");
});

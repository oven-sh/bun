import { test, vi } from "bun:test";
const turns = async count => { for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done)); };
const asked = name => { try { return String(require(name).seen); } catch { return "threw"; } };
let openOil, openWick;
const never = new Promise(() => {});
const oilGate = new Promise(open => { openOil = open; });
const wickGate = new Promise(open => { openWick = open; });
test("a", async () => {
  vi.doMock("./wick.mjs", async () => { await never; });
  vi.doMock("./oil.mjs", async () => { await oilGate; throw new RangeError("oil fails"); });
  console.log(asked("./pair.mjs"), asked("./pair.mjs"));
  openOil();
  await turns(5);
  console.log("the end");
});

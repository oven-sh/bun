import { test, vi } from "bun:test";
let wicks = 0, oils = 0, openWick, openOil;
const turns = async count => { for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done)); };
const wickGate = new Promise(open => { openWick = open; });
const oilGate = new Promise(open => { openOil = open; });
const asked = name => { try { return String(require(name).seen); } catch { return "threw"; } };
test("a", async () => {
  vi.doMock("./wick.mjs", async () => { wicks++; await wickGate; throw new RangeError("wick fails " + wicks); });
  vi.doMock("./oil.mjs", async () => { oils++; await oilGate; return { drop: "mocked oil" }; });
  console.log(asked("./pair.mjs"));
  openOil();
  await turns(5);
  console.log(asked("./pair.mjs"));
  openWick();
  await turns(5);
  console.log("the end", wicks, oils);
});

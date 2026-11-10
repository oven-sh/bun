import { test, vi } from "bun:test";
const turns = async count => { for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done)); };
const asked = name => { try { return String(require(name).seen); } catch { return "threw"; } };
let open;
const never = new Promise(() => {});
const gate = new Promise(opens => { open = opens; });
const waits = () => vi.doMock("./wick.mjs", () => never);
const fails = () => vi.doMock("./wick.mjs", async () => { await gate; throw new RangeError("wick fails"); });
test("a", async () => {
  waits();
  console.log(asked("./lamp.mjs"));
  waits();
  console.log(asked("./torch.mjs"));
  fails();
  open();
  await turns(5);
  console.log("the end");
});

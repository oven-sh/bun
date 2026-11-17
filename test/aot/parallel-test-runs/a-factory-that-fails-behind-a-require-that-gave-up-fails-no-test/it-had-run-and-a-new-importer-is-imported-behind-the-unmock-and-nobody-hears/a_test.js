import { test, vi } from "bun:test";
const turns = async count => { for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done)); };
const asked = name => { try { return String(require(name).seen); } catch { return "threw"; } };
let open;
const never = new Promise(() => {});
const gate = new Promise(opens => { open = opens; });
test("a", async () => {
  console.log(asked("./first.mjs"));
  vi.doMock("./wick.mjs", async () => { await never; });
  console.log(asked("./lamp.mjs"));
  vi.doUnmock("./wick.mjs");
  console.log((await import("./torch.mjs")).seen);
  vi.doMock("./wick.mjs", async () => { await gate; throw new RangeError("wick fails"); });
  console.log(asked("./spark.mjs"));
  open();
  await turns(5);
  console.log("the end");
});

import { expect, test, vi } from "bun:test";
const turns = async count => { for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done)); };
const asked = name => { try { return String(require(name).seen); } catch { return "threw"; } };
let open;
const never = new Promise(() => {});
const gate = new Promise(opens => { open = opens; });
test("a", async () => {
  vi.doMock("./wick.mjs", async () => { await never; });
  console.log(asked("./lamp.mjs"));
  vi.doMock("./wick.mjs", async () => { await gate; return { width: "second" }; });
  console.log(asked("./torch.mjs"));
  open();
  await turns(5);
  vi.doMock("./wick.mjs", () => { throw new RangeError("the third fails at once"); });
  console.log(asked("./spark.mjs"));
  await turns(5);
  console.log("the end");
});

import { test, vi } from "bun:test";
const turns = async count => { for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done)); };
const asked = name => { try { return String(require(name).seen); } catch { return "threw"; } };
const never = new Promise(() => {});
test("a", async () => {
  vi.doMock("./wick.mjs", async () => { await never; });
  console.log(asked("./lamp.mjs"));
  vi.doMock("./wick.mjs", async () => { await never; });
  console.log(asked("./torch.mjs"));
  vi.doMock("./wick.mjs", async () => { throw new RangeError("the third fails at once"); });
  console.log(await import("./spark.mjs").then(() => "came", error => error.message));
  await turns(5);
  console.log("the end");
});

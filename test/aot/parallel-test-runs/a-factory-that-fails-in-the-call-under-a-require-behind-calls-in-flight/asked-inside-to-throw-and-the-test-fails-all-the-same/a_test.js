import { expect, test, vi } from "bun:test";
const turns = async count => { for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done)); };
const asked = name => { try { return String(require(name).seen); } catch { return "threw"; } };
let open;
const never = new Promise(() => {});
const gate = new Promise(opens => { open = opens; });
test("a", async () => {
  vi.doMock("./wick.mjs", async () => { await never; });
  expect(() => require("./lamp.mjs")).toThrow();
  vi.doMock("./wick.mjs", async () => { await never; });
  expect(() => require("./torch.mjs")).toThrow();
  vi.doMock("./wick.mjs", async () => { throw new RangeError("the third fails at once"); });
  expect(() => require("./spark.mjs")).toThrow();
  console.log("all three threw");
  console.log("all three threw");
  await turns(5);
  console.log("the end");
});

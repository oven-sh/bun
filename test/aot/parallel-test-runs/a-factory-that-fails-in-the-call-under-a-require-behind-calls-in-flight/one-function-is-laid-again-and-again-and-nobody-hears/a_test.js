import { beforeEach, expect, test, vi } from "bun:test";
const turns = async count => { for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done)); };
const never = new Promise(() => {});
const made = vi.fn();
beforeEach(() => { vi.doMock("./wick.mjs", made); });
test("a", () => {
  made.mockImplementation(async () => { await never; });
  expect(() => require("./lamp.mjs")).toThrow();
});
test("b", () => {
  made.mockImplementation(async () => { await never; });
  expect(() => require("./torch.mjs")).toThrow();
});
test("c", async () => {
  made.mockImplementation(async () => { throw new RangeError("the third fails at once"); });
  expect(() => require("./spark.mjs")).toThrow();
  await turns(5);
  console.log("the end");
});

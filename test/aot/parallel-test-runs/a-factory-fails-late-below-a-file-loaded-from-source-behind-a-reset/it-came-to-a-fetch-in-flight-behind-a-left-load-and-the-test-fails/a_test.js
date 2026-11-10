import { beforeEach, expect, test, vi } from "bun:test";
const turns = async count => { for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done)); };
let open, openFirst;
const never = new Promise(() => {});
const gate = new Promise(opens => { open = opens; });
const firstGate = new Promise(opens => { openFirst = opens; });
test("a", async () => {
  vi.doMock("./wick.mjs", async () => { await firstGate; return { width: "first" }; });
  expect(() => require("./lamp.mjs")).toThrow();
  openFirst();
  await turns(5);
  console.log("lamp threw");
  vi.resetModules();
});
test("b", () => {
  vi.doMock("./wick.mjs", async () => { await never; });
  expect(() => require("./torch.mjs")).toThrow();
  vi.doMock("./wick.mjs", async () => { await gate; throw new RangeError("wick fails"); });
  expect(() => require("./spark.mjs")).toThrow();
  console.log("both threw");
});
test("c", async () => {
  open();
  await turns(5);
  console.log("the end");
});

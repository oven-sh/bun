import { beforeEach, expect, test, vi } from "bun:test";
const turns = async count => { for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done)); };
let open, openFirst;
const gate = new Promise(opens => { open = opens; });
const firstGate = new Promise(opens => { openFirst = opens; });
beforeEach(() => { vi.resetModules(); });
test("a", async () => {
  vi.doMock("./wick.mjs", async () => { await firstGate; return { width: "first" }; });
  expect(() => require("./lamp.mjs")).toThrow();
  openFirst();
  await turns(5);
  console.log("lamp threw");
});
test("b", () => {
  vi.doMock("./wick.mjs", async () => { await gate; throw new RangeError("wick fails"); });
  expect(() => require("./torch.mjs")).toThrow();
  console.log("torch threw");
});
test("c", async () => {
  open();
  await turns(5);
  console.log("the end");
});

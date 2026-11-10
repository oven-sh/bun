import { beforeEach, expect, test, vi } from "bun:test";
const turns = async count => { for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done)); };
let open;
const gate = new Promise(done => (open = done));
beforeEach(() => { vi.resetModules(); });
test("the shuttle needs the spool", () => {
  vi.doMock("./spool.mjs", async () => { await gate; return { thread: "first" }; });
  expect(() => require("./shuttle.mjs")).toThrow();
});
test("the heddle says once that the thread snapped", async () => {
  const load = vi.fn(async () => { throw new Error("snapped"); });
  vi.doMock("./spool.mjs", () => load());
  expect(() => require("./heddle.mjs")).toThrow();
  open();
  await turns(6);
  console.log("the later factory was called", load.mock.calls.length, "times");
  expect(load).toHaveBeenCalledTimes(1);
});

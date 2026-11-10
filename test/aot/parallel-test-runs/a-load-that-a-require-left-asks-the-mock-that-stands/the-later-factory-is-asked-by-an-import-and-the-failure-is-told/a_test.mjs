import { expect, test, vi } from "bun:test";
const turns = async count => { for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done)); };
let open, calls = 0;
const gate = new Promise(done => (open = done));
const waits = name => async () => { await gate; return { thread: name }; };
test("the shuttle needs the spool", () => {
  vi.doMock("./spool.mjs", waits("shuttle"));
  expect(() => require("./shuttle.mjs")).toThrow();
});
test("the reed needs the spool", () => {
  vi.doMock("./spool.mjs", waits("reed"));
  expect(() => require("./reed.mjs")).toThrow();
});
test("the heddle says that the thread snapped", async () => {
  vi.doMock("./spool.mjs", async () => { calls++; throw new Error("snapped"); });
  await expect(import("./heddle.mjs")).rejects.toThrow();
});
test("the day goes on", async () => {
  open();
  await turns(6);
  console.log("the later factory was called", calls, "times");
});

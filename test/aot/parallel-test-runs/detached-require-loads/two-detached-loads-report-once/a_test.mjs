import { expect, test, vi } from "bun:test";
const runEventLoop = async count => { for (let i = 0; i < count; i++) await new Promise(done => setImmediate(done)); };
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
test("heddle reports the snap", () => {
  vi.doMock("./spool.mjs", () => { calls++; throw new Error("snapped"); });
  expect(() => require("./heddle.mjs")).toThrow();
});
test("later test still passes", async () => {
  open();
  await runEventLoop(6);
  console.log("the later factory was called", calls, "times");
});

import { afterEach, expect, test, vi } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
const gate = Promise.withResolvers();
afterEach(() => {
  vi.doUnmock("./wick.mjs");
  vi.resetModules();
});
test("gives up while the factory is slow", () => {
  vi.doMock("./wick.mjs", async () => { await new Promise(() => {}); return { width: "slow" }; });
  expect(() => require("./lamp.mjs")).toThrow();
  console.log("slow");
});
test("gives up on a factory that will fail", () => {
  vi.doMock("./wick.mjs", async () => { await gate.promise; throw new RangeError("the factory fails"); });
  expect(() => require("./torch.mjs")).toThrow();
  console.log("down");
});
test("later", async () => {
  gate.resolve();
  await spinEventLoop();
  console.log("later");
});

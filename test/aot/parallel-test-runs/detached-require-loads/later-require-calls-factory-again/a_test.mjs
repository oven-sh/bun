import { test, vi } from "bun:test";
const runEventLoop = async count => { for (let i = 0; i < count; i++) await new Promise(done => setImmediate(done)); };
const describeError = error => "threw " + (/^snapped/.test(error.message) ? error.message : error.constructor.name);
const tryRequire = name => { try { return String(require(name).label); } catch (error) { return describeError(error); } };
test("later require calls factory again", async () => {
  let spoolCalls = 0;
  vi.doMock("./spool.mjs", async () => { spoolCalls++; await new Promise(() => {}); return { thread: "never" }; });
  console.log("the first:", tryRequire("./loom.mjs"));
  vi.doMock("./spool.mjs", () => { spoolCalls++; throw new Error("snapped " + spoolCalls); });
  console.log("the fresh one:", tryRequire("./shuttle.mjs"));
  await runEventLoop(5);
  console.log("the factories were called", spoolCalls, "times behind the load that was left");
  console.log("a later one:", tryRequire("./heddle.mjs"));
  console.log("the factories were called", spoolCalls, "times behind the later one");
});

import { test, vi } from "bun:test";
const runEventLoop = async count => { for (let i = 0; i < count; i++) await new Promise(done => setImmediate(done)); };
const describeError = error => "threw " + (/^snapped/.test(error.message) ? error.message : error.constructor.name);
const tryRequire = name => { try { return String(require(name).label); } catch (error) { return describeError(error); } };
test("retry needs no settlement", async () => {
  let spoolCalls = 0;
  vi.doMock("./spool.mjs", async () => { spoolCalls++; await new Promise(() => {}); return { thread: "never" }; });
  console.log("the first:", tryRequire("./loom.mjs"));
  vi.doMock("./spool.mjs", () => { spoolCalls++; throw new Error("snapped " + spoolCalls); });
  console.log("the fresh one:", tryRequire("./shuttle.mjs"));
  console.log("the factories were called", spoolCalls, "times at the require that failed");
  await runEventLoop(5);
  console.log("the factories were called", spoolCalls, "times and nothing has settled");
});

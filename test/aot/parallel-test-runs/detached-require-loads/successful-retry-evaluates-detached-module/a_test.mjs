import { test, vi } from "bun:test";
const runEventLoop = async count => { for (let i = 0; i < count; i++) await new Promise(done => setImmediate(done)); };
const describeError = error => "threw " + (/^snapped/.test(error.message) ? error.message : error.constructor.name);
const tryRequire = name => { try { return String(require(name).label); } catch (error) { return describeError(error); } };
test("successful retry evaluates detached module", async () => {
  let spoolCalls = 0;
  vi.doMock("./spool.mjs", async () => { spoolCalls++; await new Promise(() => {}); return { thread: "never" }; });
  console.log("the first:", tryRequire("./loom.mjs"));
  vi.doMock("./spool.mjs", () => { spoolCalls++; if (spoolCalls === 2) throw new Error("snapped 2"); return { thread: "later " + spoolCalls }; });
  console.log("the fresh one:", tryRequire("./shuttle.mjs"));
  await runEventLoop(5);
  console.log("the factories were called", spoolCalls, "times and nothing has settled");
  console.log("the file that failed, again:", tryRequire("./shuttle.mjs"));
  console.log("the factories were called", spoolCalls, "times at the end");
});

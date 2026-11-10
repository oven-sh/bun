import { test, vi } from "bun:test";
const runEventLoop = async count => { for (let i = 0; i < count; i++) await new Promise(done => setImmediate(done)); };
const describeError = error => "threw " + (/^snapped/.test(error.message) ? error.message : error.constructor.name);
const tryRequire = name => { try { return String(require(name).label); } catch (error) { return describeError(error); } };
test("retry waits for pending remock", async () => {
  let spoolCalls = 0;
  vi.doMock("./spool.mjs", async () => { spoolCalls++; await new Promise(() => {}); return { thread: "never" }; });
  console.log("the first:", tryRequire("./loom.mjs"));
  let openRemockGate;
  const remockGate = new Promise(done => (openRemockGate = done));
  vi.doMock("./spool.mjs", () => { spoolCalls++; if (spoolCalls === 2) throw new Error("snapped 2"); return remockGate.then(() => ({ thread: "later " + spoolCalls })); });
  console.log("the fresh one:", tryRequire("./shuttle.mjs"));
  await runEventLoop(5);
  console.log("the factories were called", spoolCalls, "times while the later factory waits");
  openRemockGate();
  await runEventLoop(5);
  console.log("the factories were called", spoolCalls, "times once it has settled");
});

import { test, vi } from "bun:test";
const runEventLoop = async count => { for (let i = 0; i < count; i++) await new Promise(done => setImmediate(done)); };
const describeError = error => "threw " + (/^snapped/.test(error.message) ? error.message : error.constructor.name);
const tryRequire = name => { try { return String(require(name).label); } catch (error) { return describeError(error); } };
test("failed import causes no retry", async () => {
  let openSpoolGate, openBobbinGate, spoolCalls = 0, bobbinCalls = 0;
  const spoolGate = new Promise(done => (openSpoolGate = done));
  const bobbinGate = new Promise(done => (openBobbinGate = done));
  vi.doMock("./spool.mjs", async () => { spoolCalls++; await spoolGate; return { thread: "first" }; });
  vi.doMock("./bobbin.mjs", async () => { bobbinCalls++; await bobbinGate; return { thread: "wound" }; });
  console.log("the first:", tryRequire("./loom.mjs"));
  vi.doMock("./spool.mjs", () => { spoolCalls++; if (spoolCalls === 2) throw new Error("snapped 2"); return { thread: "later " + spoolCalls }; });
  console.log("the fresh one:", await import("./shuttle.mjs").then(file => String(file.label), describeError));
  await runEventLoop(5);
  console.log("the factories were called", spoolCalls, "and", bobbinCalls, "times and nothing has settled");
});

import { test, vi } from "bun:test";
const runEventLoop = async count => { for (let i = 0; i < count; i++) await new Promise(resolve => setImmediate(resolve)); };
const describeError = error => "threw " + (/^snapped/.test(error.message) ? error.message : error.constructor.name);
const tryRequire = name => { try { return String(require(name).label); } catch (error) { return describeError(error); } };
test("fresh require calls remock", async () => {
  let openSpoolGate, openBobbinGate, spoolCalls = 0, bobbinCalls = 0;
  const spoolGate = new Promise(resolve => (openSpoolGate = resolve));
  const bobbinGate = new Promise(resolve => (openBobbinGate = resolve));
  vi.doMock("./spool.mjs", async () => { spoolCalls++; await spoolGate; return { thread: "first" }; });
  vi.doMock("./bobbin.mjs", async () => { bobbinCalls++; await bobbinGate; return { thread: "wound" }; });
  console.log("the first:", tryRequire("./loom.mjs"));
  vi.doMock("./spool.mjs", () => { spoolCalls++; return { thread: "later " + spoolCalls }; });
  openBobbinGate();
  await runEventLoop(5);
  console.log("the factories were called", spoolCalls, "and", bobbinCalls, "times once the other has settled");
  console.log("again:", tryRequire("./loom.mjs"));
  console.log("the factories were called", spoolCalls, "and", bobbinCalls, "times behind the fresh one");
});

import { test, vi } from "bun:test";
const runEventLoop = async count => { for (let i = 0; i < count; i++) await new Promise(done => setImmediate(done)); };
const tryRequire = name => { try { return String(require(name).label); } catch (error) { return "threw " + error.constructor.name; } };
test("each factory is called once", async () => {
  let failSpool, openBobbinGate, spoolCalls = 0, bobbinCalls = 0;
  const spoolFailure = new Promise((_, fail) => (failSpool = fail));
  const bobbinGate = new Promise(done => (openBobbinGate = done));
  vi.doMock("./spool.mjs", async () => { spoolCalls++; await spoolFailure; });
  vi.doMock("./bobbin.mjs", async () => { bobbinCalls++; await bobbinGate; return { thread: "wound" }; });
  console.log("the first:", tryRequire("./shuttle.mjs"));
  console.log("the second:", tryRequire("./loom.mjs"));
  openBobbinGate();
  await runEventLoop(4);
  failSpool(new Error("snapped"));
  await runEventLoop(6);
  console.log("the factories were called", spoolCalls, "and", bobbinCalls, "times");
});

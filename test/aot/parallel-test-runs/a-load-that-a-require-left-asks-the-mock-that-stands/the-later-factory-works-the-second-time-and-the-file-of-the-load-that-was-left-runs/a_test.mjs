import { test, vi } from "bun:test";
const turns = async count => { for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done)); };
const told = error => "threw " + (/^snapped/.test(error.message) ? error.message : error.constructor.name);
const asked = name => { try { return String(require(name).label); } catch (error) { return told(error); } };
test("the file of the load that was left runs", async () => {
  let spools = 0;
  vi.doMock("./spool.mjs", async () => { spools++; await new Promise(() => {}); return { thread: "never" }; });
  console.log("the first:", asked("./loom.mjs"));
  vi.doMock("./spool.mjs", () => { spools++; if (spools === 2) throw new Error("snapped 2"); return { thread: "later " + spools }; });
  console.log("the fresh one:", asked("./shuttle.mjs"));
  await turns(5);
  console.log("the factories were called", spools, "times and nothing has settled");
  console.log("the file that failed, again:", asked("./shuttle.mjs"));
  console.log("the factories were called", spools, "times at the end");
});

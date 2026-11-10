import { test, vi } from "bun:test";
const turns = async count => { for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done)); };
const told = error => "threw " + (/^snapped/.test(error.message) ? error.message : error.constructor.name);
const asked = name => { try { return String(require(name).label); } catch (error) { return told(error); } };
test("the load that was left does not ask the later factory again", async () => {
  let unwind, wind, spools = 0, bobbins = 0;
  const untilItIsUnwound = new Promise(done => (unwind = done));
  const untilItIsWound = new Promise(done => (wind = done));
  vi.doMock("./spool.mjs", async () => { spools++; await untilItIsUnwound; return { thread: "first" }; });
  vi.doMock("./bobbin.mjs", async () => { bobbins++; await untilItIsWound; return { thread: "wound" }; });
  console.log("the first:", asked("./loom.mjs"));
  vi.doMock("./spool.mjs", () => { spools++; if (spools === 2) throw new Error("snapped 2"); return { thread: "later " + spools }; });
  console.log("the fresh one:", await import("./shuttle.mjs").then(file => String(file.label), told));
  await turns(5);
  console.log("the factories were called", spools, "and", bobbins, "times and nothing has settled");
});

import { test, vi } from "bun:test";
const turns = async count => { for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done)); };
const told = error => "threw " + (/^snapped/.test(error.message) ? error.message : error.constructor.name);
const asked = name => { try { return String(require(name).label); } catch (error) { return told(error); } };
test("the file of the load that was left runs once the factory has settled", async () => {
  let spools = 0;
  vi.doMock("./spool.mjs", async () => { spools++; await new Promise(() => {}); return { thread: "never" }; });
  console.log("the first:", asked("./loom.mjs"));
  let wind;
  const untilItIsWound = new Promise(done => (wind = done));
  vi.doMock("./spool.mjs", () => { spools++; if (spools === 2) throw new Error("snapped 2"); return untilItIsWound.then(() => ({ thread: "later " + spools })); });
  console.log("the fresh one:", asked("./shuttle.mjs"));
  await turns(5);
  console.log("the factories were called", spools, "times while the later factory waits");
  wind();
  await turns(5);
  console.log("the factories were called", spools, "times once it has settled");
});

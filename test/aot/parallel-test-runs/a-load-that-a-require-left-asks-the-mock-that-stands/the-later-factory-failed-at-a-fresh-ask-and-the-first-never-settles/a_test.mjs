import { test, vi } from "bun:test";
const turns = async count => { for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done)); };
const asked = name => { try { return String(require(name).label); } catch (error) { return "threw " + (/^snapped/.test(error.message) ? error.message : error.constructor.name); } };
test("the load that was left asks again where the other factory settles", async () => {
  let unwind, wind, spools = 0, bobbins = 0;
  const untilItIsUnwound = new Promise(done => (unwind = done));
  const untilItIsWound = new Promise(done => (wind = done));
  vi.doMock("./spool.mjs", async () => { spools++; await new Promise(() => {}); return { thread: "never" }; });
  vi.doMock("./bobbin.mjs", async () => { bobbins++; await untilItIsWound; return { thread: "wound" }; });
  console.log("the first:", asked("./loom.mjs"));
  vi.doMock("./spool.mjs", () => { spools++; throw new Error("snapped " + spools); });
  console.log("the fresh one:", asked("./shuttle.mjs"));
  console.log("the factories were called", spools, "and", bobbins, "times before anything settles");
  wind();
  await turns(5);
  console.log("the factories were called", spools, "and", bobbins, "times once the other has settled");
});

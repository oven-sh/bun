import { test, vi } from "bun:test";
const turns = async count => { for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done)); };
const asked = name => { try { return String(require(name).label); } catch (error) { return "threw " + error.constructor.name; } };
test("nothing is mocked anew and each factory is called once", async () => {
  let snap, wind, spools = 0, bobbins = 0;
  const untilItSnaps = new Promise((_, fail) => (snap = fail));
  const untilItIsWound = new Promise(done => (wind = done));
  vi.doMock("./spool.mjs", async original => { spools++; await untilItSnaps; });
  vi.doMock("./bobbin.mjs", async () => { bobbins++; await untilItIsWound; return { thread: "wound" }; });
  console.log("the first:", asked("./shuttle.mjs"));
  console.log("the second:", asked("./loom.mjs"));
  snap(new Error("snapped"));
  await turns(4);
  wind();
  await turns(6);
  console.log("the factories were called", spools, "and", bobbins, "times");
});

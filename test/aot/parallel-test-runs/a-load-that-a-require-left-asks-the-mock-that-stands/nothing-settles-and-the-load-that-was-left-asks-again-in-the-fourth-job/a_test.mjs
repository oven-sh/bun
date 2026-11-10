import { test, vi } from "bun:test";
const turns = async count => { for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done)); };
const told = error => "threw " + (/^snapped/.test(error.message) ? error.message : error.constructor.name);
const asked = name => { try { return String(require(name).label); } catch (error) { return told(error); } };
test("the load that was left asks again in the fourth job", async () => {
  let spools = 0;
  vi.doMock("./spool.mjs", async () => { spools++; await new Promise(() => {}); return { thread: "never" }; });
  console.log("the first:", asked("./loom.mjs"));
  vi.doMock("./spool.mjs", () => { spools++; throw new Error("snapped " + spools); });
  console.log("the fresh one:", asked("./shuttle.mjs"));
  for (let job = 1; job <= 6; job++) {
    await Promise.resolve();
    console.log("the factories were called", spools, "times behind job", job);
  }
});

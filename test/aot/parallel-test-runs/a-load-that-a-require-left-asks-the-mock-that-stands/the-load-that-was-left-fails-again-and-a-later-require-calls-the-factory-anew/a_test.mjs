import { test, vi } from "bun:test";
const turns = async count => { for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done)); };
const told = error => "threw " + (/^snapped/.test(error.message) ? error.message : error.constructor.name);
const asked = name => { try { return String(require(name).label); } catch (error) { return told(error); } };
test("a later require calls the factory anew", async () => {
  let spools = 0;
  vi.doMock("./spool.mjs", async () => { spools++; await new Promise(() => {}); return { thread: "never" }; });
  console.log("the first:", asked("./loom.mjs"));
  vi.doMock("./spool.mjs", () => { spools++; throw new Error("snapped " + spools); });
  console.log("the fresh one:", asked("./shuttle.mjs"));
  await turns(5);
  console.log("the factories were called", spools, "times behind the load that was left");
  console.log("a later one:", asked("./heddle.mjs"));
  console.log("the factories were called", spools, "times behind the later one");
});

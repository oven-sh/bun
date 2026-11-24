import { test, vi } from "bun:test";
const turns = async count => { for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done)); };
const told = error => "threw " + (/^snapped/.test(error.message) ? error.message : error.constructor.name);
const required = name => { try { return String(require(name).label); } catch (error) { return told(error); } };
test("a detached load does not wait for a pending factory that nobody requested", async () => {
  let unwind, wind, spools = 0, bobbins = 0;
  const unwound = new Promise(done => (unwind = done));
  const wound = new Promise(done => (wind = done));
  const count = when => console.log("the factories were called", spools, "and", bobbins, "times", when);
  vi.doMock("./spool.mjs", async () => { spools++; await unwound; return { thread: "first" }; });
  console.log("the first require:", required("./shuttle.mjs"));
  vi.doMock("./spool.mjs", async () => { spools++; await wound; return { thread: "later " + spools }; });
  unwind();
  await turns(5);
  count("after the first factory settled");
});

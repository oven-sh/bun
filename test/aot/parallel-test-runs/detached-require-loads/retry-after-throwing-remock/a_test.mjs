import { test, vi } from "bun:test";
const said = (globalThis.said = []);
const runEventLoop = async count => { for (let i = 0; i < count; i++) await new Promise(done => setImmediate(done)); };
const ask = name => { try { said.push("got " + require(name).label); } catch (error) { said.push("threw " + error.constructor.name); } };
test("retry calls the registered factory", async () => {
  let open, calls = 0;
  const gate = new Promise(done => (open = done));
  vi.doMock("./spool.mjs", async () => { said.push("first"); await gate; said.push("first settles"); return { thread: "first" }; });
  ask("./shuttle.mjs");
  vi.doMock("./spool.mjs", () => { calls++; said.push("later"); throw new Error("snapped"); });
  ask("./heddle.mjs");
  open();
  await runEventLoop(6);
  console.log("the order:", said.join(" . "));
  console.log("the later factory was called", calls, "times");
});

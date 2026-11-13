import { test, vi } from "bun:test";
const said = (globalThis.said = []);
const ask = name => { try { said.push("got " + require(name).label); } catch (error) { said.push("threw " + error.constructor.name); } };
test("throwing factory is called once", () => {
  let calls = 0;
  vi.doMock("./spool.mjs", () => { calls++; said.push("factory"); throw new Error("snapped"); });
  ask("./heddle.mjs");
  ask("./reed.mjs");
  console.log("the order:", said.join(" . "));
  console.log("the factory was called", calls, "times");
});

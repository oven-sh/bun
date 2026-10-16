// What a failing assert does to Error.stackTraceLimit, by the state it starts from. One line per scenario.
const assert = require("node:assert");
class BrokenURL extends URL { get href() { throw new Error("url href"); } }
const original = Object.getOwnPropertyDescriptor(Error, "stackTraceLimit");
const plain = () => assert.strictEqual(1, 2);
const renderThrows = () => assert.deepStrictEqual({ a: new BrokenURL("http://example.com/a") }, { a: 1 });
const describe = () => { const d = Object.getOwnPropertyDescriptor(Error, "stackTraceLimit"); return d === undefined ? "absent" : "get" in d ? "accessor" : `${d.value}${d.writable ? "" : " (not writable)"}`; };
const scenarios = {
  "limit 10, plain mismatch": [() => {}, plain],
  "limit 10, message cannot be made": [() => {}, renderThrows],
  "limit 0 set by the caller, plain mismatch": [() => { Error.stackTraceLimit = 0; }, plain],
  "limit 77, message cannot be made": [() => { Error.stackTraceLimit = 77; }, renderThrows],
  "limit not writable, plain mismatch": [() => Object.defineProperty(Error, "stackTraceLimit", { value: 10, writable: false, enumerable: true, configurable: true }), plain],
  "limit not writable, message cannot be made": [() => Object.defineProperty(Error, "stackTraceLimit", { value: 10, writable: false, enumerable: true, configurable: true }), renderThrows],
  "limit deleted, plain mismatch": [() => { delete Error.stackTraceLimit; }, plain],
  "limit is an accessor, plain mismatch": [() => { let v = 10; const log = (globalThis.log = []); Object.defineProperty(Error, "stackTraceLimit", { configurable: true, enumerable: true, get() { log.push("get"); return v; }, set(x) { log.push("set " + x); v = x; } }); }, plain],
  "limit is an accessor, message cannot be made": [() => { let v = 10; const log = (globalThis.log = []); Object.defineProperty(Error, "stackTraceLimit", { configurable: true, enumerable: true, get() { log.push("get"); return v; }, set(x) { log.push("set " + x); v = x; } }); }, renderThrows],
};
for (const [name, [setup, trigger]] of Object.entries(scenarios)) {
  Object.defineProperty(Error, "stackTraceLimit", original);
  globalThis.log = undefined;
  setup();
  let thrown;
  try { trigger(); } catch (e) { thrown = e; }
  const after = describe();
  const log = globalThis.log ? " | " + globalThis.log.join(",") : "";
  Object.defineProperty(Error, "stackTraceLimit", original);
  const frames = thrown && typeof thrown.stack === "string" && thrown.stack.includes("\n    at ");
  console.log(`${name} | threw ${thrown && thrown.name} | frames on the thrown error: ${frames} | limit after: ${after}${log}`);
}

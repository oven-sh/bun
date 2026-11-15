// A test has laid a getter under the global name `process` before node:events is first loaded: the module reads the name, as in `bun test`.
const { test } = require("bun:test");
const real = process;
let reads = 0;
Object.defineProperty(globalThis, "process", { get() { reads++; return real; }, configurable: true });
const before = reads;
const EventEmitter = require("node:events");
const during = reads - before;
Object.defineProperty(globalThis, "process", { value: real, writable: true, configurable: true });
test("a", () => { console.log("a", during > 0, real instanceof EventEmitter); });

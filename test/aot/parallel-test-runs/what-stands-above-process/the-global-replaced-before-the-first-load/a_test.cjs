// A test has stored an object of its own under the global name `process` before node:events is first loaded: the module links what stands above that object, as in `bun test`.
const { test } = require("bun:test");
const real = process;
const above = { madeUp: 1 };
globalThis.process = Object.create(above);
const EventEmitter = require("node:events");
globalThis.process = real;
test("a", () => { console.log("a", Object.getPrototypeOf(real) instanceof EventEmitter, above instanceof EventEmitter); });

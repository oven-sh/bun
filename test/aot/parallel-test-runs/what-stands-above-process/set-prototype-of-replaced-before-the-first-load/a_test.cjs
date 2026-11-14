// A test has put a function of its own in the place of Object.setPrototypeOf before node:events is first loaded: the module calls it to link the native prototype of `process`, as in `bun test`.
const { test } = require("bun:test");
const original = Object.setPrototypeOf;
const native = Object.getPrototypeOf(process);
let seen = 0;
Object.setPrototypeOf = function (object, above) { if (object === native) seen++; return original(object, above); };
const EventEmitter = require("node:events");
Object.setPrototypeOf = original;
test("a", () => { console.log("a", seen, process instanceof EventEmitter); });

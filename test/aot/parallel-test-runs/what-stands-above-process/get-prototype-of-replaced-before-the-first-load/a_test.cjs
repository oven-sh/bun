// A test has put a function of its own in the place of Object.getPrototypeOf before node:events is first loaded: the module asks it what stands above `process`, as in `bun test`.
const { test } = require("bun:test");
const original = Object.getPrototypeOf;
let seen = 0;
Object.getPrototypeOf = function (object) { if (object === process) seen++; return original(object); };
const EventEmitter = require("node:events");
Object.getPrototypeOf = original;
test("a", () => { console.log("a", seen, process instanceof EventEmitter); });

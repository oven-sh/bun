// A test has deleted the global name `process` before node:events is first loaded: the module finds nothing to link and loads all the same, as in `bun test`.
const { test } = require("bun:test");
const real = process;
const isDeleted = delete globalThis.process;
const EventEmitter = require("node:events");
globalThis.process = real;
test("a", () => { console.log("a", isDeleted, real instanceof EventEmitter); });

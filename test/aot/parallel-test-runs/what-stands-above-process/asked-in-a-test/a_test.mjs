// node:events lays its EventEmitter.prototype above the native prototype of `process`, in a test run as in an executable.
import { test } from "bun:test";
import { EventEmitter } from "node:events";
test("a", () => {
  const native = Object.getPrototypeOf(process);
  console.log("a", process instanceof EventEmitter, Object.getPrototypeOf(native) === EventEmitter.prototype, process.on === native.on, process._eventsCount);
  EventEmitter.prototype.madeUp = 1;
  console.log("a", process.madeUp);
  delete EventEmitter.prototype.madeUp;
});

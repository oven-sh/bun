// node:events puts its EventEmitter.prototype above the native prototype of `process`. Native code reads process.noDeprecation and process.throwDeprecation through that chain: it finds a value, and runs a getter with `process` as `this`.
const say = (...values) => console.log(...values);
const EventEmitter = require("node:events");
const nativePrototype = Object.getPrototypeOf(process);
say(Object.getPrototypeOf(nativePrototype) === EventEmitter.prototype, process instanceof EventEmitter, process.on === nativePrototype.on, process.on === EventEmitter.prototype.on);
process.on("warning", warning => say("warning", warning.name, warning.message));

let reads = 0;
Object.defineProperty(EventEmitter.prototype, "noDeprecation", {
  get() { reads++; say("getter of noDeprecation", this === process); return reads > 1; },
  configurable: true,
});
process.emitWarning("shown: the getter answers false", "DeprecationWarning");
process.emitWarning("hidden: the getter answers true", "DeprecationWarning");
delete EventEmitter.prototype.noDeprecation;

setImmediate(() => {
  EventEmitter.prototype.throwDeprecation = true;
  try {
    process.emitWarning("thrown", "DeprecationWarning");
    say("not thrown here");
  } catch (error) {
    say("caught", error.name, error.message);
  }
  process.on("uncaughtException", error => say("uncaught", error.name, error.message));
  delete EventEmitter.prototype.throwDeprecation;

  // A member that the native prototype loses is looked for above it.
  const nativeEmit = nativePrototype.emit;
  delete nativePrototype.emit;
  say(process.emit === EventEmitter.prototype.emit);
  nativePrototype.emit = nativeEmit;
  say(process.emit === nativeEmit, new EventEmitter().emit === EventEmitter.prototype.emit);
});

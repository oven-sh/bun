// RUN: lower
// OPTIONS: builtin-modules

// Above the native prototype of process lies Object.prototype until node:events is evaluated, which puts its own EventEmitter.prototype there; the native methods keep winning lookups.
const native = Object.getPrototypeOf(process);
console.log(Object.getPrototypeOf(native) === Object.prototype, process._eventsCount, process.domain);
const EventEmitter = require("node:events");
console.log(Object.getPrototypeOf(native) === EventEmitter.prototype, process._eventsCount, process instanceof EventEmitter);
console.log(process.on === native.on, process.on !== EventEmitter.prototype.on);
process.on("exit", code => console.log("exit", code));

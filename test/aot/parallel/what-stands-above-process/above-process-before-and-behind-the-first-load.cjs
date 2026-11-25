// What stands above the native prototype of `process`: Object.prototype until node:events is evaluated, its EventEmitter.prototype from then on.
const native = Object.getPrototypeOf(process);
console.log(Object.getPrototypeOf(native) === Object.prototype);
const EventEmitter = require("node:events");
console.log(native instanceof EventEmitter, Object.getPrototypeOf(native) === EventEmitter.prototype, Object.getPrototypeOf(process) === native);

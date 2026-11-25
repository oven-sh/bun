// Nothing stands above `process` when node:events is loaded: nothing is linked.
const native = Object.getPrototypeOf(process);
Object.setPrototypeOf(process, null);
const EventEmitter = require("node:events");
console.log(Object.getPrototypeOf(process), Object.getPrototypeOf(native) === Object.prototype, native instanceof EventEmitter);

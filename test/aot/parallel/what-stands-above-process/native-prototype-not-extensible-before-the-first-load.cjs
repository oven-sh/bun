// The native prototype of `process` takes no new link once it is not extensible: node:events loads all the same and `process` keeps its chain.
const native = Object.getPrototypeOf(process);
Object.preventExtensions(native);
const EventEmitter = require("node:events");
console.log(Object.getPrototypeOf(native) === Object.prototype, process instanceof EventEmitter, typeof EventEmitter, new EventEmitter().listenerCount("madeUp"));

// What stands above the native prototype of `process`, asked for by `__proto__`.
const EventEmitter = require("node:events");
process.stdout.write([process.__proto__.__proto__ === EventEmitter.prototype, process.__proto__ === EventEmitter.prototype].join() + "\n");

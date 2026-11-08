// What a program lays on EventEmitter.prototype is found off `process`, and is gone when it is deleted there.
const EventEmitter = require("node:events");
console.log(process.madeUp);
EventEmitter.prototype.madeUp = 1;
console.log(process.madeUp, "madeUp" in process, Object.hasOwn(process, "madeUp"));
delete EventEmitter.prototype.madeUp;
console.log(process.madeUp, "madeUp" in process);

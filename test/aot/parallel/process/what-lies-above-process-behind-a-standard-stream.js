// The modules of a standard stream load node:events, which puts its EventEmitter.prototype above the prototype of `process`. A program that reads a stream finds it there.
// STATISTIC: ImageFunctionsEmitted <= 200
process.stdout.write("start\n");
let depth = 0;
for (let object = process; object !== null; object = Object.getPrototypeOf(object)) depth++;
console.log(depth, typeof process._eventsCount, typeof process._events, typeof process.domain);
console.log(process.eventNames().map(String).join(), process.listenerCount("exit"), process.getMaxListeners());

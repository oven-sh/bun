// What a program, a command-line flag or node:events adds to process and to the objects above it after start-up is found by a read, a computed read and `in`.
function readFlag() {
  return process.noDeprecation;
}
function readAll() {
  return [process.noDeprecation, process.traceDeprecation, process.throwDeprecation, process.pendingDeprecation, process.traceProcessWarnings, process.noProcessWarnings].join();
}
console.log(readAll(), "noDeprecation" in process, Object.hasOwn(process, "noDeprecation"));
process.noDeprecation = true;
console.log(readFlag(), "noDeprecation" in process);
console.log("x" in process, process.x);
process.x = { y: 1 };
console.log("x" in process, process.x.y, Object.keys(process).includes("x"));
console.log(process._events, process._eventsCount, process._maxListeners, "_events" in process);
const EventEmitter = require("node:events");
console.log(process._events, process._eventsCount, process._maxListeners, "_events" in process);
EventEmitter.prototype.added = function () {
  return "added " + (this === process);
};
console.log(process.added());
Object.getPrototypeOf(process).alsoAdded = 3;
console.log(process.alsoAdded + 1);
console.log(typeof process._debugEnd, typeof process._debugProcess, typeof process._startProfilerIdleNotifier, typeof process._stopProfilerIdleNotifier);
const key = ["no", "Deprecation"].join("");
console.log(process[key], delete process.noDeprecation, process[key], readFlag());
function lengthOfStored() {
  return process.throwDeprecation.length;
}
process.throwDeprecation = "text";
console.log(lengthOfStored(), typeof process.throwDeprecation);

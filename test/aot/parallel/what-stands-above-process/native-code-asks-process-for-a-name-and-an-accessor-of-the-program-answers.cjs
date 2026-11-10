// Where a deprecation is warned of, native code asks `process` for `noDeprecation`, which `process` has only in a run that was started with the flag.
// The lookup goes on to EventEmitter.prototype, and the accessor that the program has laid there gets `process` as `this`. No file of the program asks.
const EventEmitter = require("node:events");
Object.defineProperty(EventEmitter.prototype, "noDeprecation", {
  get() {
    console.log("asked", this === process, typeof this.allowedNodeEnvironmentFlags.has);
    return true;
  },
  configurable: true,
});
process.emitWarning("old", "DeprecationWarning");
console.log("done");

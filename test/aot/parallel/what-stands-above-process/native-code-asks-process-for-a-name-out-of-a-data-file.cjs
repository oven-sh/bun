// The key comes out of a data file: no file with code spells it.
const EventEmitter = require("node:events");
const names = require("./names-that-a-data-file-holds.json");
Object.defineProperty(EventEmitter.prototype, names[0], {
  get() {
    console.log("asked", this === process, typeof this.allowedNodeEnvironmentFlags.has);
    return true;
  },
  configurable: true,
});
process.emitWarning("old", "DeprecationWarning");
console.log("done");

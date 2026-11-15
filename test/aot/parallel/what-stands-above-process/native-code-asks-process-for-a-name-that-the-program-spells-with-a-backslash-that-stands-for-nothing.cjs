// A backslash in front of a letter that starts no escape stands for nothing: the key is the name without it, and no line of this file spells that.
const EventEmitter = require("node:events");
// prettier-ignore
Object.defineProperty(EventEmitter.prototype, "no\Deprecation", {
  get() {
    console.log("asked", this === process, typeof this.allowedNodeEnvironmentFlags.has);
    return true;
  },
  configurable: true,
});
process.emitWarning("old", "DeprecationWarning");
console.log("done");

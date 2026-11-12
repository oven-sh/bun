// The map of descriptors is filled by a store: the name is neither a text nor a key of a literal.
const EventEmitter = require("node:events");
const descriptors = {};
descriptors.noDeprecation = {
  get() {
    console.log("asked", this === process, typeof this.allowedNodeEnvironmentFlags.has);
    return true;
  },
  configurable: true,
};
Object.defineProperties(EventEmitter.prototype, descriptors);
process.emitWarning("old", "DeprecationWarning");
console.log("done");

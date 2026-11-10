// The key of the getter is a text with a backslash that stands for nothing, and no other file or line spells the name.
const EventEmitter = require("node:events");
// prettier-ignore
class Above {
  get "no\Deprecation"() {
    console.log("asked", this === process, typeof this.allowedNodeEnvironmentFlags.has);
    return true;
  }
}
Object.setPrototypeOf(EventEmitter.prototype, Above.prototype);
process.emitWarning("old", "DeprecationWarning");
console.log("done");

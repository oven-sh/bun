// The accessor is written in a class, and the class's prototype goes above EventEmitter.prototype: the name is a key and no text.
import { EventEmitter } from "node:events";
class Above {
  get noDeprecation() {
    console.log("asked", this === process, typeof this.allowedNodeEnvironmentFlags.has);
    return true;
  }
}
Object.setPrototypeOf(EventEmitter.prototype, Above.prototype);
process.emitWarning("old", "DeprecationWarning");
console.log("done");

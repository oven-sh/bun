// The key at the definer is what an enum answers for a number: the name stands in the file as the name of a member of the enum.
import { EventEmitter } from "node:events";
enum Names {
  noDeprecation,
}
Object.defineProperty(EventEmitter.prototype, Names[0], {
  get() {
    console.log("asked", this === process, typeof (this as any).allowedNodeEnvironmentFlags.has);
    return true;
  },
  configurable: true,
});
process.emitWarning("old", "DeprecationWarning");
console.log("done");

// Env: NODE_NO_WARNINGS=1
import { EventEmitter } from "node:events";
import util from "node:util";
process.on("warning", warning => console.log("warned", warning.name));
Object.defineProperty(EventEmitter.prototype, "noDeprecation", {
  get() {
    console.log("asked", this === process);
    return true;
  },
});
util.deprecate(() => {}, "x")();
process.emitWarning("y", "DeprecationWarning");
await new Promise(resolve => setTimeout(resolve, 10));
console.log("done");

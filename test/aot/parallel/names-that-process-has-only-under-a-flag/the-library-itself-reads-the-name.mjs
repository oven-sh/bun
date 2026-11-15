// What util.deprecate() made reads process.noDeprecation in Bun's own text. The accessor that the program laid above process answers that read too, and finds all of process on `this`.
import { EventEmitter } from "node:events";
import util from "node:util";
Object.defineProperty(EventEmitter.prototype, "noDeprecation", {
  get() {
    console.log("asked", typeof this.allowedNodeEnvironmentFlags.has);
    return true;
  },
});
util.deprecate(() => {}, "old", "DEP0")();
console.log("behind");

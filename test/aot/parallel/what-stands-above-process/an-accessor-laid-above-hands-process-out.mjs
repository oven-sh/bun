// A getter on EventEmitter.prototype answers a name that `process` lacks, and gets `process` as `this`. What the program then asks of it is in the executable.
import { EventEmitter } from "node:events";
Object.defineProperty(EventEmitter.prototype, "madeUp", {
  get() {
    return this;
  },
  configurable: true,
});
const held = process.madeUp;
console.log("same", held === process);
console.log("output", held.stdout instanceof EventEmitter, typeof held.stdout.cork);
console.log("input", typeof held.stdin.isPaused());
console.log("more", typeof held.allowedNodeEnvironmentFlags, typeof held.report, typeof held.finalization);

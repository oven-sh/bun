// The program writes to the standard output by name, which alone needs little of the stream, and asks the same stream for more through what a getter above `process` handed out.
import { EventEmitter } from "node:events";
Object.defineProperty(EventEmitter.prototype, "madeUp", {
  get() {
    return this;
  },
  configurable: true,
});
const { madeUp: held } = process;
process.stdout.write("written\n");
console.log("kinds", typeof held.stdout.cork, typeof held.stdout.end, held.stdout.listenerCount("drain"));
held.stdout.cork();
held.stdout.uncork();
console.log("corked");

// A getter that a program lays on EventEmitter.prototype is found off `process` and gets it as `this`.
import { EventEmitter } from "node:events";
Object.defineProperty(EventEmitter.prototype, "madeUp", { get() { return this === process ? typeof this.pid : "another"; }, configurable: true });
process.stdout.write(process.madeUp + " " + new EventEmitter().madeUp + "\n");

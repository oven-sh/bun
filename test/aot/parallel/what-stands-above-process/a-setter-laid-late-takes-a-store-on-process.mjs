// A setter that a program lays on EventEmitter.prototype takes a store on `process`.
import { EventEmitter } from "node:events";
let stored = "";
Object.defineProperty(EventEmitter.prototype, "madeUp", { set(value) { stored += (this === process) + " " + value; }, configurable: true });
process.madeUp = 7;
process.stdout.write(stored + " " + Object.hasOwn(process, "madeUp") + "\n");

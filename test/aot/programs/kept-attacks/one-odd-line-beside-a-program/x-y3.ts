// One odd line that never runs stands beside a program that does not change. It prints what plain Bun prints.
import { EventEmitter } from "node:events";
const log: string[] = [];
class Meter { measure(): string { return "first"; } }
const emitter = new EventEmitter();
emitter.on("meter", (back: any) => { Object.getPrototypeOf(back).measure = function (): string { return "replaced"; }; });
emitter.emit("meter", new Meter());
log.push(new Meter().measure());
console.log(log.join("; "));

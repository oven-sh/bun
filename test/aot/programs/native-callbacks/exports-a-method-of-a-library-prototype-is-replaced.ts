// Exports of start-up modules: the program replaces EventEmitter.prototype.emit, as tracing tools do, so the library's own calls of emit, in streams and in the process, reach the program's function with the library's arguments.
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

let total = 0;
const names = new Set<string>();
const original = EventEmitter.prototype.emit;

function traced(this: EventEmitter, name: string, value: number): boolean {
  total += typeof name === "string" ? 1 : 1000000;
  if (typeof value !== "number" && value !== undefined) names.add(typeof value);
  return Reflect.apply(original, this, arguments);
}

EventEmitter.prototype.emit = traced as typeof original;
const own = new EventEmitter();
own.on("value", () => {});
own.emit("value", 1);
own.emit(Symbol("s"), 2);
let chunks = 0;
for await (const chunk of Readable.from(["a", "b"])) chunks += String(chunk).length;
EventEmitter.prototype.emit = original;
own.emit("value", 3);
console.log(total > 1000002, total % 1000000 > 2, chunks, [...names].sort().join());

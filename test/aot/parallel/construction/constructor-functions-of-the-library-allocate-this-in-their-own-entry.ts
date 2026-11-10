// Constructor functions of the library are constructed by value 900 times: each has an entry that allocates `this`, as a program's own constructor function has, and the run time is not asked for it
// COUNT: operation:operationAOTCreateThis <= 20
import { EventEmitter } from "node:events";
import { Writable, PassThrough } from "node:stream";
const table: Record<string, any> = {};
const names = process.argv.length > 99 ? ["a", "b", "c"] : ["emitter", "writable", "through"];
table[names[0]] = EventEmitter;
table[names[1]] = Writable;
table[names[2]] = PassThrough;
function make(holder: Record<string, any>, name: string, options?: object) { return new holder[name](options); }
const turns = Number(process.argv[2] ?? 3) * 100;
const log: string[] = [];
let heard = 0;
for (let turn = 0; turn < turns; turn++) {
  const emitter = make(table, "emitter");
  emitter.on("x", () => heard++);
  emitter.emit("x");
  const writable = make(table, "writable", { write(chunk: unknown, encoding: string, done: () => void) { done(); } });
  const through = make(table, "through");
  if (turn < 2 || turn === turns - 1)
    log.push([emitter instanceof EventEmitter, writable instanceof Writable, writable instanceof EventEmitter, through instanceof PassThrough, through.readable, through.writable, Object.getPrototypeOf(emitter) === EventEmitter.prototype, emitter.listenerCount("x"), Object.keys(emitter).sort().join()].join(" "));
}
console.log(heard, log.join("\n"));

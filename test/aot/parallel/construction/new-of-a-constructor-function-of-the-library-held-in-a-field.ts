// Constructor functions of the library are constructed by value 900 times: the run time makes `this`, and goes its slow road only while it learns a layout and where the allocator wants a new block
// COUNT: counter:ThisMadeBySlowOperation <= 200
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
const table: Record<string, any> = {};
const names = process.argv.length > 99 ? ["a", "b", "c"] : ["emitter", "readable", "writable"];
table[names[0]] = EventEmitter;
table[names[1]] = Readable;
table[names[2]] = Writable;
function make(holder: Record<string, any>, name: string, options?: object) { return new holder[name](options); }
const turns = Number(process.argv[2] ?? 3) * 100;
const log: string[] = [];
let listeners = 0;
for (let turn = 0; turn < turns; turn++) {
  const emitter = make(table, "emitter");
  emitter.on("x", () => listeners++);
  emitter.emit("x");
  const readable = make(table, "readable", { read() {} });
  const writable = make(table, "writable", { write(chunk: unknown, encoding: string, done: () => void) { done(); } });
  if (turn < 2 || turn === turns - 1)
    log.push([emitter instanceof EventEmitter, readable instanceof Readable, readable instanceof EventEmitter, writable instanceof Writable, readable.readable, writable.writable, Object.getPrototypeOf(emitter) === EventEmitter.prototype, emitter.listenerCount("x"), Object.keys(emitter).sort().join()].join(" "));
}
class Heir extends EventEmitter { tag = "heir"; }
const heir = new Heir();
log.push(heir.tag + " " + (heir instanceof EventEmitter) + " " + heir.listenerCount("x"));
const odd = Reflect.construct(EventEmitter, [], Array);
log.push(Array.isArray(odd) + " " + (odd instanceof Array) + " " + (odd instanceof EventEmitter));
console.log(listeners, log.join("\n"));

import { EventEmitter } from "node:events";
import { Readable, Transform } from "node:stream";
import { inherits } from "node:util";
class Bus extends EventEmitter { constructor(name) { super(); this.name = name; } shout(v) { return this.emit("shout", this.name + v); } }
class Given extends EventEmitter {}
class Numbers extends Readable { constructor(limit) { super({ objectMode: true }); this.next = 0; this.limit = limit; } _read() { this.push(this.next < this.limit ? this.next++ : null); } }
function Old(name) { EventEmitter.call(this); this.name = name; }
inherits(Old, EventEmitter);
let heard = "";
for (let i = 0; i < 3; i++) {
  const bus = new Bus("b" + i), given = new Given(), old = new Old("o" + i);
  bus.on("shout", v => { heard += v; });
  given.once("x", v => { heard += v; });
  old.on("y", function (v) { heard += this.name + v; });
  bus.shout("!"); given.emit("x", i); given.emit("x", i); old.emit("y", "?");
  heard += [bus instanceof EventEmitter, given instanceof Given, old instanceof EventEmitter, old.listenerCount("y")].join("");
}
console.log(heard);
const all = [];
for await (const n of new Numbers(4)) all.push(n);
console.log(all.join(), new Transform() instanceof Readable);

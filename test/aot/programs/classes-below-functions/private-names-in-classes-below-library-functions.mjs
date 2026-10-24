// Classes with private state extend functions of Bun's own modules: private fields between public ones, a private method, a private accessor, `accessor`, `#name in`,
// a class below such a class, a private name read by a closure and by a static method, and a second initialization of one object.
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
class Counter extends EventEmitter {
  #count = 0;
  step = 2;
  #limit = 7;
  bump() { if (this.#count < this.#limit) this.#count += this.step; this.emit("count", this.#count); return this; }
  get count() { return this.#count; }
  static is(it) { return #limit in it; }
  static peek(it) { return it.#count + ":" + it.#limit; }
}
class Guarded extends EventEmitter {
  open = true;
  #check() { return this.open ? "open" : "shut"; }
  get #state() { return this.#check() + this.listenerCount("x"); }
  set #state(value) { this.open = value; }
  accessor label = "g";
  toggle() { this.#state = !this.open; return this.#state; }
}
class Deeper extends Counter {
  #own = "deep";
  name = "d";
  describe() { const read = () => this.#own + this.name + this.count; return read(); }
}
class Numbers extends Readable {
  #next = 0;
  #last;
  constructor(last) { super({ objectMode: true }); this.#last = last; }
  _read() { this.push(this.#next < this.#last ? this.#next++ : null); }
}
class Sum extends Writable {
  #total = 0;
  constructor() { super({ objectMode: true }); }
  _write(chunk, encoding, done) { this.#total += chunk; done(); }
  get total() { return this.#total; }
}
const counter = new Counter();
const heard = [];
counter.on("count", n => heard.push(n));
for (let i = 0; i < 6; i++) counter.bump();
console.log(counter.count, heard.join(), Counter.is(counter), Counter.is(new EventEmitter()), Counter.peek(counter), Object.keys(counter).join());
try { Counter.peek(new EventEmitter()); } catch (error) { console.log(error.constructor.name); }
const guarded = new Guarded();
guarded.on("x", () => {});
console.log(guarded.toggle(), guarded.toggle(), guarded.label, Object.keys(guarded).join());
const deeper = new Deeper();
deeper.on("count", n => heard.push(-n));
console.log(deeper.bump().bump().describe(), Counter.is(deeper), Counter.peek(deeper), heard.slice(-2).join(), Object.keys(deeper).join());
let made = 0;
for (let i = 0; i < 2000; i++) made += new Counter().bump().count + new Deeper().bump().describe().length;
console.log(made);
function Same() { return counter; }
Object.setPrototypeOf(Counter, Same);
try { new Counter(); } catch (error) { console.log(error.constructor.name, counter.step, Counter.peek(counter)); }
Object.setPrototypeOf(Counter, EventEmitter);
console.log(new Counter().bump().count);
const sum = new Sum();
sum.on("finish", () => console.log("total", sum.total, Object.keys(sum).filter(key => !key.startsWith("_")).join()));
new Numbers(100).pipe(sum);

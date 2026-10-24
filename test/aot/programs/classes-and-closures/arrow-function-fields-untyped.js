// Classes in JavaScript whose fields are arrow functions: each object gets functions of its own, which see the object they were made for, have the names of their fields, and stay alive and apart however many objects are made.
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
class Counter {
  count = 0;
  increment = () => ++this.count;
  add = (n) => (this.count += n);
  reset = () => { this.count = 0; return this; };
  read = () => this.count;
  self = () => this;
  twice = (f) => f(f(this.count));
  async later() { return this.read(); }
  wait = async () => this.count;
  *each() { yield this.count; }
  constructor(start) { if (start) this.count = start; }
}
const first = new Counter(), second = new Counter(5);
console.log(first.increment(), first.increment(), second.increment(), first.read(), second.read(), first.self() === first, second.self() === second);
console.log(first.increment !== second.increment, first.increment === first.increment, first.add.name, first.add.length, first.twice.length, first.wait.name, typeof first.read.prototype, Object.keys(first).join());
const { increment, read } = second;
console.log(increment(), increment.call(first), read.apply(null), new Counter(1).twice(n => n + 1));
console.log((() => { try { return new first.read(); } catch (error) { return error.constructor.name; } })(), String(Object.getPrototypeOf(first.wait) === Object.getPrototypeOf(async () => {})), Object.getPrototypeOf(first.read) === Function.prototype);
first.read.tag = "tagged";
console.log(first.read.tag, second.read.tag, new Counter().read.tag, Object.keys(first.read).join());
// Many objects, kept and dropped, through collections.
const kept = [];
let sum = 0;
for (let i = 0; i < 30000; i++) {
  const counter = new Counter(i);
  sum += counter.add(1) + counter.increment();
  if (i % 100 === 0) kept.push(counter, counter.read, counter.self);
  if (i % 10000 === 9999) collect();
}
collect();
let checked = 0;
for (let i = 0; i < kept.length; i += 3) checked += kept[i + 1]() === kept[i].count && kept[i + 2]() === kept[i] ? 1 : 1000000;
console.log(sum, checked);
// Functions that capture more than the object, or nothing, among those that capture the object alone.
function make(label, base) {
  return class {
    a = () => label + this.n;
    b = () => this.n;
    c = () => label;
    d = () => 7;
    e = () => base + this.n;
    f = () => [this.a(), this.b(), this.c(), this.d(), this.e()].join();
    n = base * 2;
  };
}
const One = make("one", 1), Two = make("two", 2);
const shown = new Set();
for (let i = 0; i < 500; i++) shown.add(new One().f() + " " + new Two().f());
console.log([...shown].join(" | "));
// A subclass, and a field that reads an earlier one.
class Loud extends Counter {
  shout = () => "count " + this.read();
  again = this.shout;
  whisper = () => this.shout().toLowerCase();
  both = () => this.again === this.shout;
}
const loud = new Loud(3);
console.log(loud.shout(), loud.again(), loud.whisper(), loud.both(), Object.keys(loud).join());
loud.wait().then(value => console.log("waited", value, [...loud.each()].join()));

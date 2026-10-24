// A closure that a program stores into a field is one object from the store on: every read gives that object, another object's field gives another,
// a second store gives a new one, and what was read before the second store stays what it was.
const lines = [];
function say(...values) {
  lines.push(values.map(String).join(" "));
}

class Counter {
  count = 0;
  step = by => {
    this.count += by ?? 1;
    return this.count;
  };
  peek = () => this.count;
  static = () => "no capture";
  constructor(start) {
    this.count = start;
  }
  replace() {
    this.peek = () => this.count * 100;
  }
}

function make(start) {
  return new Counter(start);
}

// Kept across later calls and read afterwards.
const kept = [];
for (let i = 0; i < 40; i++) {
  const counter = make(i);
  if (i % 4 === 0) kept.push({ counter, step: counter.step });
  else if (i % 4 === 1) kept.push({ counter, step: null });
  else counter.step(2);
}
let same = 0;
let different = 0;
for (let i = 0; i < kept.length; i++) {
  const entry = kept[i];
  if (entry.step) same += entry.step === entry.counter.step ? 1 : 0;
  else same += entry.counter.step === entry.counter.step ? 1 : 0;
  for (let j = 0; j < i; j++) different += kept[j].counter.step !== entry.counter.step ? 1 : 0;
}
say("kept", kept.length, same, different);
say("calls", kept[0].step(5), kept[0].counter.peek(), kept[1].counter.step(), kept[1].counter.count, kept[2].step(), kept[2].counter.count);

// The function taken out of one object goes on working on that object.
const a = make(10);
const b = make(20);
const stepOfA = a.step;
const peekOfB = b.peek;
b.step = stepOfA;
say("moved", b.step === a.step, b.step(1), a.count, b.count, peekOfB(), b.peek === peekOfB);

// A second store gives a new function.
const c = make(3);
const firstPeek = c.peek;
c.replace();
const secondPeek = c.peek;
c.replace();
say("replaced", firstPeek === secondPeek, secondPeek === c.peek, firstPeek(), secondPeek(), c.peek(), c.peek === c.peek);

// Without a read in between.
const d = make(4);
d.replace();
d.replace();
say("replaced unread", d.peek(), d.peek === d.peek);

// Properties of the function object.
const e = make(5);
e.step.tag = "tagged";
e.static.calls = 1;
e.static.calls += 1;
say("properties", e.step.tag, e.static.calls, make(5).step.tag, make(5).static.calls, e.step.name, e.step.length, e.static.name, typeof e.peek);
e.replace();
e.peek.tag = "second";
e.replace();
say("properties after a store", e.peek.tag, e.peek.name);

// Keys of collections.
const byFunction = new Map();
const weak = new WeakMap();
const set = new Set();
const many = [];
for (let i = 0; i < 10; i++) {
  const counter = make(i);
  many.push(counter);
  byFunction.set(counter.step, i);
  weak.set(counter.peek, i * 2);
  set.add(counter.static);
  set.add(counter.static);
}
let found = 0;
for (const counter of many) found += byFunction.get(counter.step) + weak.get(counter.peek) + (set.has(counter.static) ? 100 : 0);
say("collections", byFunction.size, set.size, found, byFunction.has(make(1).step), weak.has(make(1).peek));

// bind, call, apply.
const f = make(7);
const bound = f.step.bind({ count: 1000 });
say("bound", bound(1), f.count, f.step.call({ count: 5 }, 2), f.step.apply(null, [3]), f.count, bound.name);

// A store in a loop: every turn stores a new function.
class Slot {
  handler;
  value = 1;
}
const slot = new Slot();
const handlers = [];
for (let i = 0; i < 5; i++) {
  slot.handler = () => slot.value + 1;
  if (i % 2 === 0) handlers.push(slot.handler);
}
say("loop", handlers[0] !== handlers[1], handlers[1] !== handlers[2], handlers[2] === slot.handler, handlers[0](), slot.handler());

class Looped {
  value = 2;
  run;
  fill(times, taken) {
    for (let i = 0; i < times; i++) {
      this.run = () => this.value * 3;
      if (taken && i % 2) taken.push(this.run);
    }
    return this;
  }
}
const taken = [];
const looped = new Looped().fill(6, taken);
say("loop on this", taken.length, taken[0] !== taken[1], taken[2] === looped.run, new Looped().fill(3, null).run(), new Looped().run, taken[0]());

// A store on only one path.
class Sometimes {
  name;
  greet;
  constructor(name, polite) {
    this.name = name;
    if (polite) this.greet = () => "dear " + this.name;
  }
}
const people = [];
for (let i = 0; i < 12; i++) people.push(new Sometimes("p" + i, i % 3 === 0));
say("one path", people.map(person => (person.greet ? person.greet() : typeof person.greet)).join());
say("one path keys", Object.keys(people[0]).join(), Object.keys(people[1]).join(), "greet" in people[1], people[1].hasOwnProperty("greet"), people[3].greet === people[3].greet);

// Generators and async arrows.
class Streams {
  base = 10;
  numbers = function* () {
    yield 1;
    yield 2;
  };
  later = async by => {
    await null;
    return this.base + by;
  };
  laterTwice = async () => (await this.later(1)) + (await this.later(2));
}
const streams = [new Streams(), new Streams()];
say("generators", [...streams[0].numbers()].join(), streams[0].numbers === streams[0].numbers, streams[0].numbers !== streams[1].numbers, streams[0].later !== streams[1].later);
streams[1].base = 100;
const results = await Promise.all([streams[0].later(1), streams[1].later(2), streams[0].laterTwice(), streams[1].laterTwice()]);
say("async", results.join(), streams[0].later === streams[0].later, Object.getPrototypeOf(streams[0].later) === Object.getPrototypeOf(async () => {}));

// Literals.
function literal(n) {
  const object = {
    n,
    plain: () => "plain",
    double: () => object.n * 2,
  };
  object.triple = () => object.n * 3;
  return object;
}
const literals = [];
for (let i = 0; i < 30; i++) literals.push(literal(i));
let sum = 0;
for (const object of literals) sum += object.double() + object.triple() + object.plain().length;
say("literals", sum, literals[1].double === literals[1].double, literals[1].double !== literals[2].double, literals[1].triple === literals[1].triple, literals[3].plain !== literals[4].plain, Object.keys(literals[5]).join());
const copied = { ...literals[6] };
copied.n = 1000;
say("copy of a literal", copied.double === literals[6].double, copied.double(), copied.triple(), copied.plain === literals[6].plain);

console.log(lines.join("\n"));

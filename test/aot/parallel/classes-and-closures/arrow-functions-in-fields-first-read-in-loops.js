// A class gives each of its objects arrow functions as fields. Loops that run often read some of them, call some, compare them and hand
// them on, for young objects and for objects that have lived through collections.
class Counter {
  count = 0;
  label;
  constructor(label) {
    this.label = label;
  }
  add = by => (this.count += by);
  read = () => this.count;
  name = () => this.label;
  later = async by => {
    await null;
    return this.count + by;
  };
  nothing = () => "nothing";
  never = () => this.label + this.count;
}

const kept = [];
function keep(value) {
  kept.push(value);
  if (kept.length > 64) kept.shift();
  return value;
}

function use(counter, turn) {
  const add = counter.add;
  add(turn & 7);
  counter.add(1);
  const read = keep(counter.read);
  return read() + (counter.read === read ? 1 : 1000) + (counter.add === add ? 1 : 1000) + counter.nothing().length;
}

let sum = 0;
for (let turn = 0; turn < 20000; turn++) sum += use(new Counter("c" + (turn & 3)), turn);
console.log(sum);

// The objects are old when their closures are made.
const old = [];
for (let index = 0; index < 3000; index++) old.push(new Counter("old" + index));
Bun.gc(true);
Bun.gc(true);
let text = 0;
for (const counter of old) {
  const name = counter.name;
  counter.taken = name;
  text += name().length;
}
Bun.gc(true);
for (let index = 0; index < 200000; index++) keep({ index });
Bun.gc(true);
for (const counter of old) text += counter.name().length + (counter.taken === counter.name ? 0 : 100000) + counter.read();
console.log(text);

// Two objects have two closures, and a closure keeps its own object.
const first = new Counter("first");
const second = new Counter("second");
console.log(first.name === second.name, first.nothing === second.nothing, first.name(), second.name.call(first), Object.keys(first).join());
const borrowed = first.add;
second.add = borrowed;
second.add(5);
console.log(first.count, second.count, second.add === first.add);

let awaited = 0;
for (let turn = 0; turn < 2000; turn++) {
  const counter = new Counter("a");
  counter.add(turn & 15);
  const later = counter.later;
  awaited += (await later(1)) + (await counter.later(2)) + (later === counter.later ? 0 : 100000);
}
console.log(awaited, typeof first.later, first.later.constructor.name, first.never.name, first.never.length, first.add.length);

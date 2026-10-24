// The instances of every evaluation of a class have one layout. What one evaluation owns stays its own: prototype, captured values, static fields, private names.
function makeCounter(step, label) {
  return class Counter {
    static made = 0;
    static describe() { return label + " made " + Counter.made; }
    #secret = label;
    n = 0;
    optional;
    constructor(start) { if (start !== undefined) this.n = start; Counter.made++; }
    bump() { this.n += step; return this.n; }
    plain() { return this.n * 2; }
    get stepSize() { return step; }
    reveal(other) { return other.#secret; }
    static owns(value) { return #secret in value; }
  };
}

const ByOne = makeCounter(1, "one");
const ByTen = makeCounter(10, "ten");
const classes = [ByOne, ByTen];
const all = [];
for (let i = 0; i < 6; i++) all.push(new classes[i & 1](i));

let total = 0;
for (let round = 0; round < 3; round++) {
  for (const counter of all) total += counter.bump() + counter.plain() + counter.stepSize;
}
console.log(total, all.map(counter => counter.n).join());

console.log(ByOne === ByTen, ByOne.prototype === ByTen.prototype, ByOne.prototype.bump === ByTen.prototype.bump);
console.log(all.map(counter => Object.getPrototypeOf(counter) === ByOne.prototype).join());
console.log(all.map(counter => counter instanceof ByOne).join(), all.map(counter => counter instanceof ByTen).join());
console.log(all.map(counter => counter.constructor === ByTen).join());
console.log(ByOne.describe(), "|", ByTen.describe(), "|", ByOne.made, ByTen.made);

console.log(ByOne.owns(all[0]), ByOne.owns(all[1]), ByTen.owns(all[0]), ByTen.owns(all[1]), ByOne.owns({}));
console.log(all[0].reveal(all[2]), all[1].reveal(all[3]));
for (const [reader, read] of [[all[0], all[1]], [all[1], all[0]]]) {
  try {
    console.log(reader.reveal(read));
  } catch (error) {
    console.log(error.constructor.name);
  }
}

console.log(ByOne.prototype.bump.call(all[1]), ByTen.prototype.bump.call(all[0]), all[0].n, all[1].n);

ByTen.prototype.extra = "only on ten";
ByTen.prototype.plain = function () { return -this.n; };
Object.defineProperty(ByOne.prototype, "optional", { get() { return "never seen: the field is an own property"; }, configurable: true });
console.log(all.map(counter => String(counter.extra)).join(), all.map(counter => counter.plain()).join(), all.map(counter => String(counter.optional)).join());

const Late = makeCounter(100, "late");
const late = new Late();
console.log(late.bump(), late.plain(), late.extra, Late.describe(), late instanceof ByOne, Late.owns(late), ByOne.owns(late));

class Subclass extends ByTen {
  bump() { return super.bump() + 1; }
}
const derived = new Subclass(5);
console.log(derived.bump(), derived.n, derived.plain(), derived.extra, derived instanceof ByTen, derived instanceof ByOne, ByTen.owns(derived), ByOne.owns(derived), ByTen.made);

const borrowed = Reflect.construct(ByOne, [7], ByTen);
console.log(borrowed.bump(), Object.getPrototypeOf(borrowed) === ByTen.prototype, ByOne.owns(borrowed), ByTen.owns(borrowed), ByOne.made, ByTen.made);

console.log(Object.keys(all[0]).join(), JSON.stringify(all[1]), JSON.stringify(late));
delete all[0].n;
all[1].added = true;
Object.freeze(all[2]);
try {
  "use strict";
  all[2].bump();
} catch (error) {
  console.log(error.constructor.name);
}
console.log(Object.keys(all[0]).join(), all[0].bump(), Object.keys(all[1]).join(), all[2].n, all[3].bump());

// The function that allocates an instance asks for its prototype at once, also right after a collection, and with a field that is no integer.
function constructAndCheck(Class, start) {
  const made = new Class(start);
  return Object.getPrototypeOf(made) === Class.prototype && made instanceof Class && made.n === start;
}
let agreed = 0;
for (let i = 0; i < 60; i++) {
  if (i % 20 === 0) Bun.gc(true);
  if (constructAndCheck(classes[i & 1], i + 0.5)) agreed++;
}
console.log(agreed, ByOne.made, ByTen.made);

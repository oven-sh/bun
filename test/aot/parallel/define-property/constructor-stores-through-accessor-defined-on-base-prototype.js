function describe(object) {
  return [object.size, Object.hasOwn(object, "size"), "size" in object, Object.keys(object).join(), JSON.stringify(object)].join(" ");
}

let taken = 0;
function Base() {}
Object.defineProperty(Base.prototype, "size", {
  set(value) {
    taken += value;
    this.stored = value;
  },
  get() {
    return this.stored * 2;
  },
});
function Derived(size) {
  this.stored = 0;
  this.size = size;
  this.extra = 1;
}
Object.setPrototypeOf(Derived.prototype, Base.prototype);
function sumOf(rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    const made = new Derived(round & 7);
    sum += made.size + made.extra;
  }
  return sum;
}
console.log(sumOf(1000), taken, describe(new Derived(1)));
const kept = [new Derived(1), new Derived(2), new Derived(3)];
function storeInto(object, value) {
  object.size = value;
}
for (const object of kept) storeInto(object, 5);
console.log(kept.map(describe).join(" | "), taken);

let text = "";
function Named() {}
Object.defineProperty(Named.prototype, "size", {
  set(value) {
    text += value;
  },
  get() {
    return "inherited";
  },
});
function Labeled(size) {
  this.size = size;
  this.extra = 1;
}
Object.setPrototypeOf(Labeled.prototype, Named.prototype);
const computed = ["si", "ze"].join("");
class WithOwnField extends Labeled {
  [computed] = "own";
}
const mixed = [new Labeled(1), new WithOwnField("two"), new Labeled("three"), new WithOwnField(4)];
let read = "";
for (let round = 0; round < 8; round++) {
  const object = mixed[round & 3];
  read += object.size + ",";
  object.size = round & 1 ? round : "r" + round;
  read += object.size + " ";
}
console.log(read, text, mixed.map(describe).join(" | "));

let removed = 0;
function Removable() {}
Object.defineProperty(Removable.prototype, "size", {
  set(value) {
    removed += value;
  },
  get() {
    return -1;
  },
  configurable: true,
});
function BelowRemovable(size) {
  this.size = size;
}
Object.setPrototypeOf(BelowRemovable.prototype, Removable.prototype);
function makeAndRead(rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum += new BelowRemovable(round & 7).size;
  return sum;
}
const early = new BelowRemovable(9);
console.log(makeAndRead(100), removed, describe(early));
delete Removable.prototype.size;
console.log(makeAndRead(100), removed, describe(early), describe(new BelowRemovable(4)));
early.size = 6;
console.log(describe(early));

let relinked = 0;
function Linked() {}
Object.defineProperty(Linked.prototype, "size", {
  set(value) {
    relinked += value;
  },
  get() {
    return -2;
  },
});
function BelowLinked(size) {
  this.size = size;
}
Object.setPrototypeOf(BelowLinked.prototype, Linked.prototype);
function makeLinked(rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum += new BelowLinked(round & 7).size;
  return sum;
}
const linked = new BelowLinked(9);
console.log(makeLinked(100), relinked, describe(linked));
Object.setPrototypeOf(BelowLinked.prototype, { other: 1 });
console.log(makeLinked(100), relinked, describe(linked), describe(new BelowLinked(4)));

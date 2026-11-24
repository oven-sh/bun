// Accessors that code defines under names that it does not spell, read and stored in loops.
const parts = ["wide", "high", "deep"];
function define(target, ending) {
  for (const part of parts) {
    const kept = "_" + part + ending;
    target[kept] = part.length;
    Object.defineProperty(target, part + ending, {
      get() {
        return this[kept];
      },
      set(value) {
        this[kept] = value > 90 ? 0 : value;
      },
      configurable: true,
    });
  }
  return target;
}
class Crate {
  constructor(name) {
    this.name = name;
    define(this, "In");
  }
  grow(times) {
    for (let turn = 0; turn < times; turn++) {
      this.wideIn += turn;
      this.highIn = this.wideIn + this.deepIn;
      this.deepIn = this.highIn % 7;
    }
    return this.wideIn * 10000 + this.highIn * 100 + this.deepIn;
  }
}
const plain = define({}, "Out");
function swing(box, times) {
  let sum = 0;
  for (let turn = 0; turn < times; turn++) {
    box.wideOut = (box.wideOut + 3) % 50;
    box.deepOut += box.highOut;
    sum += box.wideOut + box.deepOut;
  }
  return sum;
}
const crates = ["a", "b", "c"].map(name => new Crate(name));
for (let round = 0; round < 30; round++) {
  const line = crates.map(crate => crate.grow(6)).join() + " " + swing(plain, 9);
  if (round % 9 === 0) console.log(round, line);
}
console.log(Object.keys(crates[0]).join(), Object.keys(plain).join(), Object.getOwnPropertyNames(plain).join());
Object.defineProperty(crates[1], "wide" + "In", { value: 4, writable: true });
console.log(crates[1].grow(3), crates[1]._wideIn);
delete crates[2].highIn;
console.log(crates[2].grow(2), Object.hasOwn(crates[2], "highIn"));
const below = Object.create(plain);
console.log(swing(below, 2), Object.keys(below).join(), swing(plain, 1));
console.log(swing(define(define({}, "In"), "Out"), 3), swing({ wideOut: 1, deepOut: "x", highOut: 2 }, 2), Number.isNaN(swing({}, 1)));
parts.push("name");
try {
  define(Object.freeze({}), "In");
} catch (error) {
  console.log(error.constructor.name);
}
console.log(define(new Crate("d"), "").name, new Crate("e").nameIn);

// The methods of a class that extends Map iterate each other's generators: one leaves some out, one yields pairs, one hands them to a callback.
class Shelf extends Map {
  constructor(entries, least) {
    super(entries);
    this.least = least;
    this.asked = 0;
  }
  *kept() {
    for (const entry of super.entries()) {
      this.asked++;
      if (entry[1] >= this.least) yield entry;
    }
  }
  *keys() {
    for (const [key] of this.kept()) yield key;
  }
  *values() {
    for (const entry of this.kept()) yield entry[1];
  }
  *entries() {
    yield* this.kept();
  }
  *backwards() {
    const all = [...this.kept()];
    for (let at = all.length; at--;) yield all[at];
  }
  forEach(action, self = this) {
    for (const [key, value] of this) action.call(self, value, key, this);
  }
  [Symbol.iterator]() {
    return this.entries();
  }
}
class TallShelf extends Shelf {
  *kept() {
    let left = 3;
    for (const entry of super.kept()) {
      if (left-- <= 0) return "full";
      yield [entry[0] + "^", entry[1] * 2];
    }
  }
}
function filled(kind, count, least) {
  const shelf = new kind([], least);
  for (let at = 0; at < count; at++) shelf.set("k" + at, (at * 5) % 11);
  return shelf;
}
for (let round = 0; round < 20; round++) {
  for (const kind of [Shelf, TallShelf]) {
    const shelf = filled(kind, 6 + (round % 5), round % 7);
    let sum = 0;
    for (const value of shelf.values()) sum += value;
    const each = [];
    shelf.forEach(function (value, key, whole) {
      each.push(key + value + (whole === shelf) + (this === shelf));
    });
    if (round % 6 === 0) console.log(kind.name, sum, [...shelf.keys()].join(), [...shelf.backwards()].join(";"), each.join(), shelf.asked, shelf.size);
  }
}
const shelf = filled(Shelf, 8, 3);
const walk = shelf.entries();
console.log(walk.next().value.join(), shelf.delete("k3"), walk.next().value.join());
shelf.set("late", 50);
console.log([...walk].join(";"), walk.next().done);
const early = [];
for (const [key, value] of shelf) {
  early.push(key);
  if (value > 5) break;
}
console.log(early.join());
shelf.kept = function* () {
  yield ["own", 1];
  return 4;
};
console.log([...shelf.keys()].join(), [...shelf.values()].join(), [...shelf].join());
delete shelf.kept;
Shelf.prototype.kept = function* () {
  throw new RangeError("closed");
};
try {
  console.log([...shelf.values()]);
} catch (error) {
  console.log(error.constructor.name, error.message);
}
const thrown = filled(TallShelf, 4, 0);
try {
  thrown.forEach(() => {});
} catch (error) {
  console.log(error.constructor.name);
}

// Freezing an array says nothing about what lies above it: a store under a name that Array.prototype has a setter for runs the setter.
// The second half reads frozen arrays in hot loops while, halfway, something is tried on them that a frozen array refuses or passes on: what the loops read stays the same.
"use strict";
function report(name, run) {
  let text;
  try {
    text = String(run());
  } catch (error) {
    text = error.name + ": " + error.message;
  }
  console.log(name + " -> " + text);
}
let seen = "nothing";
Object.defineProperty(Array.prototype, "watched", {
  set(value) {
    seen = "the setter ran with " + value + " on " + this.length + " elements";
  },
  get() {
    return "from the getter";
  },
  configurable: true,
});
Object.defineProperty(Array.prototype, "fixedAbove", { value: 1, writable: false, configurable: true });
const key = Symbol("watched under a symbol");
Object.defineProperty(Array.prototype, key, {
  set(value) {
    seen = "the setter under a symbol ran with " + value;
  },
  configurable: true,
});

const makers = [
  ["integers", () => [1, 2, 3]],
  ["fractions", () => [1.5, 2.5]],
  ["texts", () => ["a", "b"]],
  ["nothing", () => []],
  ["made at run time", () => Array.from({ length: 3 }, (_, index) => index * 2)],
];
for (const [kind, make] of makers) {
  report(kind + ", frozen, a written name", () => { seen = "nothing"; Object.freeze(make()).watched = 5; return seen; });
  report(kind + ", frozen, a computed name", () => { seen = "nothing"; Object.freeze(make())[["wat", "ched"].join("")] = 6; return seen; });
  report(kind + ", frozen, a symbol", () => { seen = "nothing"; Object.freeze(make())[key] = 7; return seen; });
  report(kind + ", frozen, Reflect.set", () => { seen = "nothing"; return Reflect.set(Object.freeze(make()), "watched", 8) + " " + seen; });
  report(kind + ", frozen, a read-only name above", () => { Object.freeze(make()).fixedAbove = 2; return "stored"; });
  report(kind + ", frozen, a name nobody has", () => { Object.freeze(make()).absent = 2; return "stored"; });
  report(kind + ", frozen, the getter", () => Object.freeze(make()).watched);
  report(kind + ", sealed", () => { seen = "nothing"; Object.seal(make()).watched = 9; return seen; });
  report(kind + ", as it is", () => { seen = "nothing"; make().watched = 10; return seen; });
}

function attempt(action) {
  try {
    return String(action());
  } catch (error) {
    return error.name;
  }
}
const disturbances = [
  ["a store that a setter takes", array => { array.watched = 1; }],
  ["a store under a name nobody has", array => { array.absent = 1; }],
  ["pop", array => array.pop()],
  ["another prototype", array => Object.setPrototypeOf(array, null)],
  ["the same prototype", array => Object.setPrototypeOf(array, Array.prototype)],
  ["length made writable", array => Object.defineProperty(array, "length", { writable: true })],
  ["an element defined as it is", array => Object.defineProperty(array, 0, { value: array[0] })],
  ["an element defined anew", array => Object.defineProperty(array, 0, { value: -1 })],
];
function sum(array) {
  let total = 0;
  for (let index = 0; index < array.length; index++) total += array[index];
  return total;
}
for (const [name, disturb] of disturbances) {
  for (const [kind, make] of [["integers", () => [1, 2, 3, 4]], ["fractions", () => [0.5, 1.5, 2.5]]]) {
    const array = Object.freeze(make());
    let total = 0, outcome = "";
    for (let turn = 0; turn < 4000; turn++) {
      if (turn === 2000) outcome = attempt(() => disturb(array));
      total += sum(array);
    }
    console.log(name + ", " + kind + ": " + outcome + " | " + total + " | " + array.join() + " | " + array.length + " | " + Object.isFrozen(array) + " | " + attempt(() => { array[0] = 9; }) + " | " + Object.keys(array).join() + " | " + (Object.getPrototypeOf(array) === Array.prototype));
  }
}

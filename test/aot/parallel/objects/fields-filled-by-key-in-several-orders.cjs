// Fields of compiled objects are filled first by key: in one order, in others, behind a deletion, and beside a frozen object.
const values = JSON.parse('[7, "seven", [7], null, 3.5]');
function Plain() {}
Plain.prototype.fill = function (n) {
  this.a = values[n % 5];
  this.b = values[(n + 1) % 5];
  this.c = values[(n + 2) % 5];
  this.d = values[(n + 3) % 5];
  this.e = values[(n + 4) % 5];
  this.f = undefined;
  return this;
};
globalThis.Plain = Plain;

const orders = [
  ["a", "b", "c", "d", "e", "f"],
  ["f", "e", "d", "c", "b", "a"],
  ["c", "a", "f", "b", "e", "d"],
];

function copyByKey(from, names) {
  const copy = new Plain();
  for (let i = 0; i < names.length; i++) copy[names[i]] = from[names[i]];
  return copy;
}

function clone(from) {
  const copy = new Plain();
  Object.keys(from).forEach((key) => {
    copy[key] = from[key];
  });
  return copy;
}

const describe = (object) => Object.entries(object).map(([key, value]) => `${key}=${Array.isArray(value) ? `[${value}]` : value}`).join();
const seen = new Map();
const note = (text) => seen.set(text, (seen.get(text) ?? 0) + 1);

const full = new Plain().fill(7);
for (let i = 0; i < 300; i++) {
  note(describe(copyByKey(full, orders[0])));
  note(describe(clone(full)));
  const names = orders[i % orders.length];
  const copy = copyByKey(full, names);
  note(describe(copy));
  if (i % 5 === 0) {
    delete copy[names[1]];
    copy[names[1]] = "again";
    note(describe(copy));
  }
  if (i % 7 === 0) {
    const part = new Plain();
    part[names[2]] = 1;
    part[names[0]] = 2;
    part.late = 3;
    part[names[4]] = 4;
    note(describe(part));
    const frozen = Object.freeze(clone(part));
    frozen[names[1]] = 5;
    note(describe(frozen));
  }
}
for (const [text, count] of seen) console.log(count, text);

let stored = 0;
Object.defineProperty(Plain.prototype, "d", {
  configurable: true,
  set() {
    stored++;
  },
});
for (let i = 0; i < 20; i++) note(describe(copyByKey(full, orders[0])));
console.log(stored, describe(copyByKey(full, orders[0])));

class Bare {
  init(i) {
    this.n0 = undefined;
    this.n1 = i & 1 ? i : "t";
    this.n2 = [i];
    this.n3 = () => i;
    this.n4 = i & 1 ? i : "t";
    this.n5 = "s" + i;
    return this;
  }
}
const firstNames = [
  ["n4", "n1", "n5"],
  ["n0", "n4", "n1"],
];
const initialized = new Bare().init(3);
const firsts = new Map();
for (let i = 0; i < 1500; i++) {
  const bare = new Bare();
  const names = firstNames[i % 2];
  if (i % 13 === 4) Object.freeze(bare);
  bare[names[0]] = i / 2;
  if (i % 3 === 0) bare[names[1]] = initialized[names[1]];
  const text = Object.getOwnPropertyNames(bare).join() + Object.isFrozen(bare);
  firsts.set(text, (firsts.get(text) ?? 0) + 1);
}
for (const [text, count] of firsts) console.log(count, text);

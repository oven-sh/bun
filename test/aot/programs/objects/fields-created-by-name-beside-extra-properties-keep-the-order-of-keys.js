"use strict";
// Fields of compiled objects that are created by stores by name, in many orders, on objects with and without properties that no layout lists. Every object says its keys in three ways.
class Plain {
  constructor(id) {
    this.id = id;
  }
  fill() {
    this.a = 1; this.b = 2; this.c = 3; this.d = 4; this.e = 5; this.f = 6;
  }
}
class Other {
  constructor(id) {
    this.id = id;
    this.first = id * 2;
  }
  fill() {
    this.f = 1; this.e = 2; this.d = 3; this.c = 4; this.b = 5; this.a = 6;
  }
}
function Old(id) {
  this.id = id;
}
Old.prototype.fill = function () {
  this.c = 1; this.a = 2; this.e = 3; this.b = 4; this.f = 5; this.d = 6;
};
const literal = id => ({ id, a: undefined, b: undefined });

// The receiver is one of four kinds at each of these stores.
const stores = [
  (o, v) => { o.a = v; },
  (o, v) => { o.b = v; },
  (o, v) => { o.c = v; },
  (o, v) => { o.d = v; },
  (o, v) => { o.e = v; },
  (o, v) => { o.f = v; },
];
const definitions = [
  (o, v) => Object.defineProperty(o, "a", { value: v, writable: true, enumerable: true, configurable: true }),
  (o, v) => Object.defineProperty(o, "d", { value: v, writable: true, enumerable: true, configurable: true }),
];
// Nobody knows these names at the build.
const suffix = String(process.argv.length > 99 ? process.argv[99] : "");
const extraNames = ["x" + suffix, "y" + suffix, "z" + suffix, "10" + suffix, "w" + suffix];

let seed = 12345;
const next = n => {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return (seed >>> 8) % n;
};
const make = (kind, id) => kind === 0 ? new Plain(id) : kind === 1 ? new Other(id) : kind === 2 ? new Old(id) : literal(id);
const describe = o => {
  const inLoop = [];
  for (const key in o) inLoop.push(key);
  return Object.keys(o).join() + "|" + inLoop.join() + "|" + JSON.stringify(o);
};

const seen = new Map();
let checksum = 0;
for (let round = 0; round < 6000; round++) {
  const o = make(next(4), round & 7);
  const steps = 1 + next(9);
  for (let step = 0; step < steps; step++) {
    const what = next(16);
    if (what < 9) stores[next(6)](o, step);
    else if (what < 12) o[extraNames[next(5)]] = step;
    else if (what === 12) definitions[next(2)](o, step);
    else if (what === 13) delete o[["a", "c", "e", extraNames[0]][next(4)]];
    else if (what === 14) stores[next(6)](o, undefined);
    else stores[next(6)](o, next(2) ? null : { nested: step });
  }
  const text = describe(o);
  seen.set(text, (seen.get(text) ?? 0) + 1);
  for (let i = 0; i < text.length; i++) checksum = (Math.imul(checksum, 31) + text.charCodeAt(i)) | 0;
}
console.log(seen.size, checksum);
console.log([...seen.keys()].sort().slice(0, 12).join("\n"));

// The same run of stores again and again, which is what a table remembers, with one object in between that goes another way.
const runs = [];
for (let i = 0; i < 400; i++) {
  const o = make(i % 3, 1);
  if (i % 5 === 0) o[extraNames[i % 2]] = i;
  stores[2](o, 1);
  if (i % 7 === 0) o[extraNames[2]] = i;
  stores[0](o, 2);
  if (i === 211) stores[5](o, 0);
  stores[4](o, 3);
  runs.push(Object.keys(o).join());
}
console.log([...new Set(runs)].join(" "));

// An object above others gets its fields by name too, and the objects below see them.
const above = new Plain(0);
const below = Object.create(above);
above[extraNames[1]] = 1;
stores[3](above, "from above");
console.log(below.d, Object.keys(above).join(), Object.keys(below).join());
stores[3](below, "own");
console.log(below.d, above.d, Object.keys(below).join());

// Objects that take no new properties.
for (const restrict of [Object.preventExtensions, Object.seal, Object.freeze]) {
  const o = new Other(3);
  o[extraNames[0]] = 1;
  stores[1](o, 1);
  restrict(o);
  let outcome;
  try {
    stores[4](o, 2);
    outcome = "stored";
  } catch (error) {
    outcome = error.constructor.name;
  }
  console.log(outcome, describe(o));
}

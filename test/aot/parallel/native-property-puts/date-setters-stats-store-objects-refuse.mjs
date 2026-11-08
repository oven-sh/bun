// The atime, mtime, ctime and birthtime setters of fs.Stats store on a plain object even if it is frozen, sealed or non-extensible, or the property is read-only. On other objects they throw.
import { Stats, statSync } from "node:fs";

const BigIntStats = statSync(".", { bigint: true }).constructor;
const keyOf = k => [k][0];
function describe(o, k) {
  const d = Object.getOwnPropertyDescriptor(o, keyOf(k));
  return d ? [typeof d.value, d.writable, d.enumerable, d.configurable].join() : "none";
}
function store(holder, name, o) {
  try {
    return String(Reflect.set(holder, name, "stored", o));
  } catch (e) {
    return e.constructor.name;
  }
}

class Point {
  x = 1;
  atime = 1;
}
class Below extends Point {
  y = 2;
}
function Made() {
  this.x = 1;
  this.atime = 1;
}
class WithMethod {
  atime() {
    return "method";
  }
}
function* generate() {}

const makers = {
  literal: () => ({ x: 1, atime: 1 }),
  "literal without the name": () => ({ x: 1 }),
  instance: () => new Point(),
  "instance of a subclass": () => new Below(),
  "instance of a function": () => new Made(),
  "literal with a getter": () => ({
    x: 1,
    get atime() {
      return 1;
    },
  }),
  spread: () => ({ ...{ x: 1, atime: 1 } }),
  rest: () => (({ z, ...rest }) => rest)({ z: 0, x: 1, atime: 1 }),
  "from entries": () =>
    Object.fromEntries([
      ["x", 1],
      ["atime", 1],
    ]),
  parsed: () => JSON.parse('{"x":1,"atime":1}'),
  "without a prototype": () => Object.assign(Object.create(null), { atime: 1 }),
  "prototype of a class": () => WithMethod.prototype,
  "many fields": () => Object.fromEntries(Array.from({ length: 70 }, (_, i) => ["f" + i, i]).concat([["atime", 1]])),
  array: () => Object.assign([1], { atime: 1 }),
  function: () => Object.assign(function () {}, { atime: 1 }),
  arrow: () => Object.assign(() => 1, { atime: 1 }),
  class: () =>
    class {
      static atime = 1;
    },
  generator: () => Object.assign(generate(), { atime: 1 }),
  error: () => Object.assign(new Error("x"), { atime: 1 }),
  map: () => Object.assign(new Map(), { atime: 1 }),
  date: () => Object.assign(new Date(0), { atime: 1 }),
};
const levels = {
  frozen: Object.freeze,
  sealed: Object.seal,
  closed: Object.preventExtensions,
  "read-only": o =>
    Object.defineProperty(o, "atime", { value: 1, writable: false, enumerable: true, configurable: false }),
  open: o => o,
};

for (const [kind, make] of Object.entries(makers)) {
  for (const [level, restrict] of Object.entries(levels)) {
    const o = restrict(make());
    const answer = store(Stats.prototype, "atime", o);
    console.log(
      kind,
      "|",
      level,
      "|",
      answer,
      typeof o.atime,
      describe(o, "atime"),
      Object.isFrozen(o),
      Object.isSealed(o),
      Object.isExtensible(o),
      Reflect.ownKeys(o).slice(-2).map(String).join(),
    );
  }
}

const frozen = Object.freeze({ x: 1, atime: 1, mtime: 2, ctime: 3, birthtime: 4 });
const read = () =>
  [typeof frozen.atime, typeof frozen.mtime, typeof frozen.ctime, typeof frozen.birthtime, frozen.x].join();
console.log(read());
for (const name of ["atime", "mtime", "ctime", "birthtime"])
  console.log(name, store(Stats.prototype, name, frozen), read());
const point = Object.freeze(new Point());
const readPoint = p => typeof p.atime;
console.log(readPoint(point), store(BigIntStats.prototype, "atime", point), readPoint(point), readPoint(new Point()));

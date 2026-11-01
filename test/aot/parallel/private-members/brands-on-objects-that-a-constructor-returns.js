// A base constructor that returns another object puts the private names of the classes below it on that object, whatever made it. Putting them there a second time throws, so each object has to know which classes have been through it.
const lines = [];
function attempt(name, run) {
  try {
    lines.push(name + ": " + String(run()));
  } catch (error) {
    lines.push(name + ": " + error.constructor.name);
  }
}

class Hands {
  constructor(given) {
    return given;
  }
}
class Stamp extends Hands {
  #mark = 1;
  #note;
  constructor(given, note) {
    super(given);
    this.#note = note;
  }
  static read(object) {
    return object.#mark + " " + object.#note;
  }
  static bump(object) {
    return ++object.#mark;
  }
  static has(object) {
    return #mark in object;
  }
}
class OneStamp extends Hands {
  #single = "one";
  static read(object) {
    return object.#single;
  }
}
class MethodStamp extends Hands {
  #answer() {
    return 42;
  }
  get #half() {
    return 21;
  }
  static call(object) {
    return object.#answer() + object.#half;
  }
}
// These never hand anything but their own object back, and nothing asks about their names: they are stamped by the others.
class Point {
  #x;
  #y;
  constructor(x, y) {
    this.#x = x;
    this.#y = y;
  }
  sum() {
    return this.#x + this.#y;
  }
}
class Cell {
  #value = 7;
  value() {
    return this.#value;
  }
}
class Sometimes {
  #kept = "kept";
  constructor(given) {
    if (given) return given;
  }
  kept() {
    return this.#kept;
  }
}
class BelowSometimes extends Sometimes {
  #below = "below";
  below() {
    return this.#below + " " + this.kept();
  }
}

let sum = 0;
for (let i = 0; i < 2000; i++)
  sum +=
    new Point(i & 3, 1).sum() +
    new Cell().value() +
    new Sometimes().kept().length +
    new BelowSometimes().below().length;
lines.push("sum: " + sum);

const frozen = Object.freeze({ frozen: true });
const sealed = Object.preventExtensions({ sealed: true });
const given = {
  object: {},
  array: [1, 2],
  callable: function () {},
  arrow: () => 1,
  point: new Point(1, 2),
  cell: new Cell(),
  proxy: new Proxy({}, {}),
  frozen,
  sealed,
  date: new Date(0),
  map: new Map(),
  bare: Object.create(null),
  error: new Error("e"),
  klass: Point,
  typed: new Uint8Array(2),
  promise: Promise.resolve(1),
  regexp: /a/,
  boxed: Object(1),
};
for (const [name, object] of Object.entries(given)) {
  attempt("before, " + name, () => Stamp.has(object));
  attempt("read before, " + name, () => Stamp.read(object));
  attempt("stamp, " + name, () => new Stamp(object, name) === object);
  attempt("after, " + name, () => Stamp.has(object));
  attempt("read, " + name, () => Stamp.read(object));
  attempt("bump, " + name, () => Stamp.bump(object) + Stamp.bump(object));
  attempt("stamp again, " + name, () => new Stamp(object, "again") === object);
  attempt("read after the second, " + name, () => Stamp.read(object));
  attempt("one, " + name, () => OneStamp.read(new OneStamp(object)));
  attempt("one again, " + name, () => OneStamp.read(new OneStamp(object)));
  attempt("methods before, " + name, () => MethodStamp.call(object));
  attempt("methods, " + name, () => MethodStamp.call(new MethodStamp(object)));
  attempt("methods again, " + name, () => MethodStamp.call(new MethodStamp(object)));
  attempt("below what is stamped, " + name, () => Stamp.has(Object.create(object)));
  attempt("keys, " + name, () => Reflect.ownKeys(object).length);
}
attempt("its own still work, point", () => given.point.sum());
attempt("its own still work, cell", () => given.cell.value());
attempt("point's on a stamped object", () => Point.prototype.sum.call(given.object));
attempt("cell's on a point", () => Cell.prototype.value.call(given.point));
attempt("the target of the proxy", () => {
  const target = {};
  new Stamp(new Proxy(target, {}), "p");
  return Stamp.has(target);
});

attempt("sometimes, its own", () => new Sometimes().kept());
attempt("sometimes, given", () => {
  const object = {};
  return [new Sometimes(object) === object, Sometimes.prototype.kept.call(object)];
});
attempt("below sometimes, given", () => {
  const object = {};
  const made = new BelowSometimes(object);
  return [made === object, BelowSometimes.prototype.below.call(object)];
});
attempt("below sometimes, given a whole one", () => {
  const whole = new BelowSometimes();
  return new BelowSometimes(whole) === whole;
});
attempt("below sometimes, given one of the base", () => {
  const base = new Sometimes();
  const made = new BelowSometimes(base);
  return [made === base, BelowSometimes.prototype.below.call(base)];
});
attempt("stamp given a stamp", () => {
  const first = new Stamp({}, "first");
  return new Stamp(first, "second") === first;
});
for (const value of [1, "text", null, true, Symbol.iterator, 1n])
  attempt("a primitive, " + String(value), () => typeof new Stamp(value, "p"));
attempt("undefined", () => {
  const made = new Stamp(undefined, "own");
  return [Stamp.read(made), made instanceof Stamp];
});
attempt("through Reflect.construct", () => {
  const object = {};
  return [Reflect.construct(Stamp, [object, "r"], Point) === object, Stamp.read(object)];
});
attempt("a new base", () => {
  Object.setPrototypeOf(
    OneStamp,
    class {
      constructor() {
        return given.bare;
      }
    },
  );
  return OneStamp.read(new OneStamp());
});
// A class that is evaluated many times has one layout and many private names: only the brand tells the objects of one evaluation from those of another.
function makeClass() {
  return class Made {
    #value = 1;
    static read(object) {
      return object.#value;
    }
    static has(object) {
      return #value in object;
    }
    static stamp(object) {
      return new (class extends Hands {
        #other = 2;
        static read(stamped) {
          return stamped.#other;
        }
      })(object);
    }
  };
}
const first = makeClass();
const second = makeClass();
const ofFirst = new first();
attempt("same evaluation", () => first.read(ofFirst));
attempt("other evaluation", () => second.read(ofFirst));
attempt("has, same evaluation", () => first.has(ofFirst));
attempt("has, other evaluation", () => second.has(ofFirst));
attempt("many evaluations", () => {
  let found = 0;
  for (let i = 0; i < 500; i++) {
    const made = makeClass();
    found += made.has(new made()) && !made.has(ofFirst) ? 1 : 0;
  }
  return found;
});
attempt("stamped by a class made in a function", () => first.stamp({}) !== null);
console.log(lines.join("\n"));

// Spreads, rests and Object.assign in code that runs once: sources and targets of every kind that the build can list, and what is read, listed and described afterwards.
const lines = [];
const describe = object =>
  Reflect.ownKeys(object)
    .map(key => {
      const d = Object.getOwnPropertyDescriptor(object, key);
      return String(key) + "=" + ("value" in d ? JSON.stringify(d.value) : "accessor") + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : "");
    })
    .join(",");
const show = (label, object) => lines.push(label + ": " + describe(object) + " | " + Object.keys(object).join() + " | " + (Object.getPrototypeOf(object) === Object.prototype));
const kept = [];

const plain = { a: 1, b: "two", c: true };
const other = { c: 3.5, d: null, a: undefined };
kept.push(plain, other);
show("two", { ...plain, ...other });
show("two the other way", { ...other, ...plain });
show("assigned", Object.assign({}, plain, other));
show("assigned the other way", Object.assign({}, other, plain));
show("a member behind", { ...plain, e: 5 });
show("a member in front", { e: 5, ...plain });
show("a member replaced behind", { ...plain, a: "replaced" });
show("a member replaced in front", { a: "replaced", z: 0, ...plain });
const { b: taken, ...rest } = plain;
show("rest", rest);
lines.push(String(taken));

// The source is changed between its making and the copy.
const grown = { a: 1 };
kept.push(grown);
grown.b = 2;
show("grown", { ...grown });
show("grown assigned", Object.assign({}, grown));
const shrunk = { a: 1, b: 2, c: 3 };
kept.push(shrunk);
delete shrunk.b;
show("shrunk", { ...shrunk });
show("shrunk assigned", Object.assign({ z: 1 }, shrunk));
const reordered = { a: 1, b: 2 };
kept.push(reordered);
delete reordered.a;
reordered.a = 3;
show("reordered", { ...reordered });
show("reordered assigned", Object.assign({}, reordered));
const stored = { a: 1, b: 2 };
kept.push(stored);
stored.a = "a text";
show("stored", { ...stored, ...plain });

// Getters, setters, names that are not listed, symbols, indexes.
let runs = 0;
const withGetter = {
  a: 1,
  get b() {
    runs++;
    return "got " + runs;
  },
  c: 3,
};
kept.push(withGetter);
show("getter", { ...withGetter });
show("getter assigned", Object.assign({}, withGetter));
lines.push(String(runs));
const withSetter = {
  a: 0,
  set b(value) {
    lines.push("the setter of the target ran with " + value);
  },
};
kept.push(withSetter);
show("onto a setter", Object.assign(withSetter, { a: 1, b: 2 }));
show("over a setter", { ...withSetter, b: 2 });
const hidden = { a: 1 };
Object.defineProperty(hidden, "b", { value: 2, enumerable: false });
Object.defineProperty(hidden, "c", { value: 3, enumerable: true, writable: false });
kept.push(hidden);
show("hidden", { ...hidden });
show("hidden assigned", Object.assign({}, hidden));
const symbol = Symbol("s");
const withSymbol = { a: 1, [symbol]: 2, b: 3 };
kept.push(withSymbol);
show("symbol", { ...withSymbol });
show("symbol assigned", Object.assign({}, withSymbol));
const withIndexes = { b: 1, 2: "two", a: 2, 0: "zero" };
kept.push(withIndexes);
show("indexes", { ...withIndexes });
show("indexes assigned", Object.assign({ 1: "one" }, withIndexes));
const withProto = { a: 1, ["__proto__"]: { inherited: 1 } };
kept.push(withProto);
show("an own __proto__", { ...withProto });
const assignedProto = Object.assign({}, withProto);
show("an own __proto__ assigned", assignedProto);
lines.push(String(assignedProto.inherited));

// Targets that refuse.
const frozen = Object.freeze({ a: 1 });
kept.push(frozen);
try {
  Object.assign(frozen, { a: 2 });
  lines.push("no throw");
} catch (error) {
  lines.push(error.constructor.name);
}
show("out of a frozen one", { ...frozen, b: 2 });
const readOnly = {};
Object.defineProperty(readOnly, "a", { value: 1, writable: false, enumerable: true, configurable: true });
kept.push(readOnly);
try {
  Object.assign(readOnly, plain);
  lines.push("no throw");
} catch (error) {
  lines.push(error.constructor.name);
}
show("read-only", readOnly);
const sealed = Object.seal({ a: 1 });
kept.push(sealed);
try {
  Object.assign(sealed, { a: 2, b: 3 });
  lines.push("no throw");
} catch (error) {
  lines.push(error.constructor.name);
}
show("sealed", sealed);
const below = Object.assign(
  {
    __proto__: {
      set a(value) {
        lines.push("the setter above ran with " + value);
      },
    },
  },
  plain,
);
lines.push(describe(below));

// Instances, functions, arrays, texts, nothing.
class Point {
  x = 1;
  y = 2;
  #secret = 3;
  get sum() {
    return this.x + this.y + this.#secret;
  }
}
const point = new Point();
kept.push(point);
show("instance", { ...point });
show("instance assigned", Object.assign({}, point));
show("onto an instance", Object.assign(new Point(), { y: 5, z: 6 }));
function named() {}
named.extra = 1;
show("function", { ...named });
show("array", { ...[1, 2], ...plain });
show("text", { ..."ab", ...plain });
show("nothing", { ...null, ...undefined, ...5, ...true, ...plain });
show("nothing assigned", Object.assign({}, null, undefined, 5, true, plain));

// The same object on both sides, and a copy of a copy.
const self = { a: 1, b: 2 };
kept.push(self);
show("onto itself", Object.assign(self, self));
show("of itself twice", { ...self, ...self });
const first = { ...plain, more: 1 };
const second = { ...first, evenMore: 2 };
const third = Object.assign({}, second, { a: "last" });
kept.push(first, second, third);
show("third", third);
first.a = "changed later";
show("second", second);

// Numbers of every kind in one field.
const numbers = { i: 1, d: 1.5, big: 2 ** 40, negativeZero: -0, nan: NaN };
kept.push(numbers);
const copied = { ...numbers };
lines.push([copied.i, copied.d, copied.big, Object.is(copied.negativeZero, -0), copied.nan].join());
copied.i = 2.5;
copied.d = "text";
lines.push(describe(copied) + " " + describe(numbers));

// In a function that is called once, and in one that is never hot.
function once(options) {
  const merged = { retries: 3, delay: 10, ...options };
  const assigned = Object.assign({ retries: 3, delay: 10 }, options);
  return describe(merged) + " " + describe(assigned);
}
lines.push(once({ delay: 20, label: "x" }));
function twice(options) {
  return describe({ ...plain, ...options });
}
lines.push(twice({ a: 9 }), twice({ z: 1, a: 8 }));
lines.push(String(kept.length));
console.log(lines.join("\n"));

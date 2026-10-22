// Object.assign of several sources to a new literal: sources of the usual shape, of another shape, with getters, with a key "__proto__", that are the target, and a target that a getter of an earlier source changes.
function show(object) {
  const parts = [];
  for (const key of Reflect.ownKeys(object)) parts.push(String(key) + "=" + String(object[key]));
  return "{" + parts.join(", ") + "}";
}

function merge(a, b) {
  return Object.assign({}, a, b);
}

function mergeThree(a, b, c) {
  return Object.assign({}, a, b, c);
}

function mergeIntoFields(a, b) {
  return Object.assign({ b: "own", z: 0 }, a, b);
}

function mergeWithLiteral(a, n) {
  return Object.assign({}, a, { c: n, d: n + 1 });
}

function mergeWithItself(a) {
  const target = { a: 1, b: "two" };
  return Object.assign(target, a, target);
}

let leaked;
function mergeLeaked(a, b) {
  const target = {};
  leaked = target;
  return Object.assign(target, a, b);
}

const tag = Symbol("tag");
const defaults = () => ({ a: 1, b: "defaults" });
const options = () => ({ b: "options", c: 3 });

let checksum = 0;
for (let i = 0; i < 20000; i++) {
  const merged = merge(defaults(), options());
  const three = mergeThree(defaults(), options(), defaults());
  checksum = (checksum + merged.a + merged.c + merged.b.length + three.b.length + mergeIntoFields(defaults(), options()).c + mergeWithLiteral(defaults(), i).d + mergeLeaked(defaults(), options()).c) | 0;
}
console.log(checksum);

console.log(show(merge(defaults(), options())), show(mergeThree(defaults(), options(), defaults())));
console.log(show(mergeIntoFields(defaults(), options())), show(mergeWithLiteral(defaults(), 5)), show(mergeWithItself(options())));

const reordered = { c: 30, b: "reordered" };
const extended = options();
extended.extra = true;
const shrunk = options();
delete shrunk.b;
const tagged = options();
tagged[tag] = "symbol";
const hidden = options();
Object.defineProperty(hidden, "secret", { value: 1, enumerable: false });
for (const second of [reordered, extended, shrunk, tagged, hidden, null, undefined, "xy", 7, [8, 9], Object.freeze(options())]) {
  console.log(show(merge(defaults(), second)), show(merge(second, options())), show(mergeThree(defaults(), second, options())));
}

const log = [];
const observed = {
  get a() {
    log.push("get a");
    return "from getter";
  },
  b: "plain",
};
console.log(show(mergeThree(observed, options(), observed)), log.join(";"));

const changing = options();
const definesSetter = {
  get trap() {
    Object.defineProperty(leaked, "b", {
      set(value) {
        changing.c = "changed by the setter of b, which got " + value;
      },
      configurable: true,
      enumerable: true,
    });
    return "trap";
  },
};
console.log(show(mergeLeaked(definesSetter, changing)), show(changing));

const freezes = {
  get trap() {
    Object.freeze(leaked);
    return "trap";
  },
};
try {
  console.log(show(mergeLeaked(freezes, options())));
} catch (error) {
  console.log(error.constructor.name, show(leaked));
}

const seen = [];
const prototypeWithSetter = {
  set c(value) {
    seen.push("setter of c got " + value);
  },
};
const givesPrototype = JSON.parse('{"a": 1, "__proto__": null}');
givesPrototype.__proto__ = prototypeWithSetter;
const withPrototype = merge(givesPrototype, options());
console.log(show(withPrototype), Object.getPrototypeOf(withPrototype) === prototypeWithSetter, seen.join(";"));

const throws = {
  a: "before",
  get b() {
    throw new RangeError("from a getter");
  },
};
try {
  mergeLeaked(defaults(), throws);
} catch (error) {
  console.log(error.message, show(leaked));
}

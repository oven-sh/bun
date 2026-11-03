// A store by index, by a text that is an index and by Reflect.set into objects of eight kinds, each below objects of eighteen kinds: String objects, typed arrays, arrays, proxies, objects whose
// elements have accessors or cannot be written, and chains of them. What is stored, where it lies and what is refused does not hang on how the object was made. The output is that of plain Bun.
const above = {
  "a String object": () => new String("abc"),
  "a typed array": () => new Uint8Array([7, 8, 9]),
  "an empty typed array": () => new Uint8Array(0),
  "an array": () => [7, 8, 9],
  "a frozen array": () => Object.freeze([7, 8, 9]),
  "an array with a getter and a setter": () =>
    Object.defineProperty([7], 1, {
      get() {
        return "got";
      },
      set(value) {
        this.seen = value;
      },
    }),
  "an array with a getter alone": () =>
    Object.defineProperty([7], 1, {
      get() {
        return "got";
      },
    }),
  "an object with an element that cannot be written": () =>
    Object.defineProperty({}, 1, { value: "fixed", writable: false }),
  "an arguments object": () =>
    (function () {
      return arguments;
    })(7, 8, 9),
  "a proxy that refuses": () =>
    new Proxy(
      {},
      {
        set() {
          return false;
        },
      },
    ),
  "a proxy that stores under another name": () =>
    new Proxy(
      {},
      {
        set(target, key, value, receiver) {
          return Reflect.defineProperty(receiver, "other", {
            value,
            configurable: true,
            enumerable: true,
            writable: true,
          });
        },
      },
    ),
  "a frozen literal": () => Object.freeze({ 1: "f" }),
  "a literal with an element that cannot be written": () => {
    const literal = { b: 2 };
    Object.defineProperty(literal, 1, { value: "fixed", writable: false });
    return literal;
  },
  "a literal below a String object": () => Object.setPrototypeOf({ b: 2 }, new String("abc")),
  "a created object below a String object": () => Object.create(new String("abc")),
  "a String object below a proxy that refuses": () =>
    Object.setPrototypeOf(
      new String("abc"),
      new Proxy(
        {},
        {
          set() {
            return false;
          },
        },
      ),
    ),
  "a typed array below an object with an element that cannot be written": () =>
    Object.setPrototypeOf(new Uint8Array(1), Object.defineProperty({}, 5, { value: "fixed", writable: false })),
  "a String object below an object with an element that cannot be written": () =>
    Object.setPrototypeOf(new String("a"), Object.defineProperty({}, 5, { value: "fixed", writable: false })),
};

class Instance {
  a = 1;
}
function Made() {
  this.a = 1;
}
const below = {
  "a literal": proto => Object.setPrototypeOf({ a: 1 }, proto),
  "a literal that names its prototype": proto => ({ __proto__: proto, a: 1 }),
  "an instance of a class": proto => Object.setPrototypeOf(new Instance(), proto),
  "an instance of a function": proto => Object.setPrototypeOf(new Made(), proto),
  "a created object": proto => Object.create(proto),
  "a literal that takes no more": proto => Object.preventExtensions(Object.setPrototypeOf({ a: 1 }, proto)),
  "a literal with the element": proto => Object.setPrototypeOf({ a: 1, 1: "own", 5: "own" }, proto),
  "a literal with the element, which cannot be written": proto =>
    Object.defineProperty(Object.defineProperty(Object.setPrototypeOf({ a: 1 }, proto), 1, { value: "own" }), 5, {
      value: "own",
    }),
};

const lines = [];
function say(label, run) {
  try {
    lines.push(label + ": " + JSON.stringify(run()));
  } catch (error) {
    lines.push(label + ": threw " + error.name);
  }
}
const seenOf = (object, proto, key) => [
  object[key],
  Object.hasOwn(object, key),
  Object.hasOwn(proto, key),
  object.seen,
  object.other,
];

for (const [upper, makeAbove] of Object.entries(above)) {
  for (const [lower, makeBelow] of Object.entries(below)) {
    for (const key of [1, 5, "1", JSON.parse("5")]) {
      const label = lower + " below " + upper + ", " + typeof key + " " + key;
      say(label, () => {
        const proto = makeAbove();
        const object = makeBelow(proto);
        object[key] = "z";
        return seenOf(object, proto, key);
      });
      say(label + ", by Reflect.set", () => {
        const proto = makeAbove();
        const object = makeBelow(proto);
        return [Reflect.set(object, key, "z"), ...seenOf(object, proto, key)];
      });
    }
    say(lower + " below " + upper + ", for another receiver", () => {
      const proto = makeAbove();
      const object = makeBelow(proto);
      const receiver = { r: 1 };
      return [Reflect.set(object, 1, "z", receiver), receiver[1], object[1], Object.hasOwn(object, 1)];
    });
  }
}
console.log(lines.join("\n"));

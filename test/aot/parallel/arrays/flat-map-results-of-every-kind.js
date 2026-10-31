// flatMap with callbacks that answer with literals, kept lists, holes, proxies, array-likes, subclasses and lists that change under it: the result, and the order of everything a program can observe, are those of plain Bun.
const log = [];
const show = value =>
  JSON.stringify(value, (key, v) =>
    v === undefined ? "undefined" : Object.is(v, -0) ? "-0" : typeof v === "number" && v !== v ? "NaN" : v,
  );
const print = (label, value) =>
  console.log(label, Array.isArray(value), value.length, show(value), Object.keys(value).length);
const numbers = [1, 2, 3, 4, 5];
const fractions = [0.5, 1.5, -0, NaN, 2 ** 40];
const mixed = [1, "two", null, undefined, { three: 3 }, [4]];

for (let round = 0; round < 3; round++) {
  print(
    "none",
    numbers.flatMap(() => []),
  );
  print(
    "one",
    numbers.flatMap(x => [x]),
  );
  print(
    "pair",
    numbers.flatMap(x => [x, x + 1]),
  );
  print(
    "three",
    numbers.flatMap(x => [x, String(x), { x }]),
  );
  print(
    "four",
    numbers.flatMap(x => [x, x, x, x + 0.5]),
  );
  print(
    "seven",
    numbers.flatMap(x => [x, 1, 2, 3, 4, 5, 6]),
  );
  print(
    "scalar",
    numbers.flatMap(x => x * 2),
  );
  print(
    "either",
    numbers.flatMap(x => (x & 1 ? [x] : x)),
  );
  print(
    "one or none",
    numbers.flatMap(x => (x & 1 ? [x] : [])),
  );
  print(
    "nested",
    numbers.flatMap(x => [[x], [[x]]]),
  );
  print(
    "fractions",
    fractions.flatMap(x => [x, -x]),
  );
  print(
    "mixed",
    mixed.flatMap(x => [x, x]),
  );
  print(
    "itself",
    mixed.flatMap(x => x),
  );
  print(
    "strings",
    ["a b", "c", ""].flatMap(s => s.split(" ")),
  );
  print(
    "undefined and null",
    numbers.flatMap(x => (x & 1 ? undefined : null)),
  );
}

const kept = { 0: [], 1: [1], 2: [1, 2], 3: [1, 2, 3], 4: [1, 2, 3, 4], 9: [1, 2, 3, 4, 5, 6, 7, 8, 9] };
for (const count of Object.keys(kept))
  print(
    "kept " + count,
    numbers.flatMap(() => kept[count]),
  );
const long = Array.from({ length: 300 }, (_, i) => i);
print("long", [1, 2, 3].flatMap(() => long).slice(295, 305));
const longFractions = long.map(x => x + 0.5);
print("long fractions", [1, 2].flatMap(() => longFractions).slice(298, 302));
const longWords = long.map(x => "w" + x);
print("long words", [1, 2].flatMap(() => longWords).slice(298, 302));

print(
  "holes 1",
  numbers.flatMap(() => [, 1]),
);
print(
  "holes 2",
  numbers.flatMap(() => [1, , 3]),
);
print(
  "holes 3",
  numbers.flatMap(() => [, , ,]),
);
print(
  "holes 5",
  numbers.flatMap(() => [1, , 3, , 5]),
);
print(
  "holes in fractions",
  [1, 2].flatMap(() => [0.5, , 1.5, , 2.5]),
);
print(
  "holes in the source",
  [1, , 3, , 5].flatMap((x, i) => [x, i]),
);
const sparse = [];
sparse[3] = "three";
sparse[100000] = "far";
print(
  "sparse",
  [1, 2].flatMap(() => sparse),
);
const short = [1, 2, 3, 4, 5];
short.length = 2;
print(
  "cut",
  [1, 2].flatMap(() => short),
);

const traced = list =>
  new Proxy(list, {
    get(target, key, receiver) {
      log.push("get " + String(key));
      return Reflect.get(target, key, receiver);
    },
    has(target, key) {
      log.push("has " + String(key));
      return Reflect.has(target, key);
    },
  });
for (const list of [[], [1], [1, 2], [1, 2, 3], [1, 2, 3, 4], [, 2], [1, , 3, , 5]]) {
  log.length = 0;
  print(
    "proxy",
    [0].flatMap(() => traced(list)),
  );
  console.log(log.join(" | "));
}
print(
  "array-like",
  [1, 2].flatMap(() => ({ length: 2, 0: "a", 1: "b" })),
);
print(
  "arguments",
  [1, 2]
    .flatMap(function () {
      return arguments;
    })
    .map(a => a.length),
);
print(
  "typed array",
  [1, 2].flatMap(() => new Uint8Array(2)).map(a => a.length),
);
print(
  "string",
  [1, 2].flatMap(() => "ab"),
);

class List extends Array {}
print(
  "subclass result",
  [1, 2].flatMap(x => List.of(x, x + 1)),
);
const ofSubclass = List.of(1, 2).flatMap(x => [x, x]);
console.log(ofSubclass instanceof List, ofSubclass.constructor === List, show(ofSubclass));
class Other extends Array {
  static get [Symbol.species]() {
    return Array;
  }
}
console.log(Other.of(1, 2).flatMap(x => [x]) instanceof Other);

const withGetter = [1, 2, 3];
Object.defineProperty(withGetter, 1, {
  get() {
    log.push("getter");
    withGetter.length = 2;
    return "got";
  },
  configurable: true,
  enumerable: true,
});
log.length = 0;
print(
  "getter cuts the list",
  [0].flatMap(() => withGetter),
);
console.log(log.join());
const five = [1, 2, 3, 4, 5];
Object.defineProperty(five, 1, {
  get() {
    five.pop();
    return "got";
  },
  configurable: true,
  enumerable: true,
});
print(
  "getter pops",
  [0].flatMap(() => five),
);

const growing = [1, 2, 3];
print(
  "source grows",
  growing.flatMap((x, i, all) => {
    if (i === 0) all.push(9);
    return [x];
  }),
);
const shrinking = [1, 2, 3, 4];
print(
  "source shrinks",
  shrinking.flatMap((x, i, all) => {
    if (i === 0) all.length = 2;
    return [x, x];
  }),
);
const returned = [1, 2];
print(
  "result changes later",
  [1, 2, 3].flatMap(x => {
    returned.push(x);
    return returned;
  }),
);
print(
  "this and arguments",
  [5, 6].flatMap(
    function (x, i, all) {
      return [this.base + x, i, all.length];
    },
    { base: 10 },
  ),
);

for (const bad of [undefined, null, 1, {}, "f"]) {
  try {
    [1].flatMap(bad);
  } catch (error) {
    console.log(error.constructor.name, error.message);
  }
}
try {
  [1, 2, 3].flatMap(x => {
    if (x === 2) throw new RangeError("at two");
    return [x];
  });
} catch (error) {
  console.log(error.constructor.name, error.message);
}
console.log(show(Array.prototype.flatMap.call({ length: 3, 0: "a", 2: "c" }, (x, i) => [x, i])));
console.log(show(Array.prototype.flatMap.call("ab", x => [x, x])));

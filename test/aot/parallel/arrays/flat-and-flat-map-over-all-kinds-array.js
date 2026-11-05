// flat() and flatMap() ask `index in array` and define elements by index: over int32, double and any-value storage, holes, frozen and sealed targets, subclasses, array-likes and proxies.
const lines = [];
const show = value => JSON.stringify(value, (_, v) => (v === undefined ? "undefined" : Object.is(v, -0) ? "-0" : typeof v === "number" && v !== v ? "NaN" : v));
function attempt(name, run) {
  try {
    lines.push(`${name}: ${show(run())}`);
  } catch (error) {
    lines.push(`${name}: ${error.constructor.name}`);
  }
}
const describe = array => [array.length, Object.keys(array).join(), show(Array.from(array))];

const int32s = [1, 2, 3, 4];
const doubles = [1.5, 2.5, 3.5, 4.5];
const values = ["a", 1, 2.5, null, undefined, { k: 1 }];
const withNaN = [1.5, NaN, -0, 0];
const int32sWithHole = [1, , 3];
const doublesWithHole = [1.5, , 3.5];
const valuesWithHole = ["a", , "c"];
const grown = [];
grown[5] = 1.5;
const sources = { int32s, doubles, values, withNaN, int32sWithHole, doublesWithHole, valuesWithHole, grown, empty: [] };

for (let round = 0; round < 3; round++) {
  for (const [name, source] of Object.entries(sources)) {
    attempt(`${name} pairs`, () => describe(source.flatMap(x => [x, x])));
    attempt(`${name} doubles`, () => describe(source.flatMap((x, i) => [i + 0.5, i + 1.5])));
    attempt(`${name} int32s`, () => describe(source.flatMap((x, i) => [i, i + 1, i + 2])));
    attempt(`${name} scalar`, () => describe(source.flatMap(x => x)));
    attempt(`${name} holes`, () => describe(source.flatMap(x => [x, , x])));
    attempt(`${name} double holes`, () => describe(source.flatMap((x, i) => [i + 0.5, , i + 1.5])));
    attempt(`${name} nested`, () => describe(source.flatMap(x => [[x], [[x]]])));
    attempt(`${name} none`, () => describe(source.flatMap(() => [])));
    attempt(`${name} many`, () => describe(source.flatMap((x, i) => Array.from({ length: i * 3 }, (_, k) => k + 0.25))));
    attempt(`${name} flat`, () => describe([source, [source], 1.5].flat()));
    attempt(`${name} flat 2`, () => describe([source, [source, [source]]].flat(2)));
    attempt(`${name} in`, () => [0, 1, 2, 5, 6, -1].map(k => k in source));
    attempt(`${name} hasOwn`, () => [0, 1, 2, 5, 6, -1].map(k => Object.hasOwn(source, k)));
  }
}

function species(make) {
  return class extends Array {
    static get [Symbol.species]() {
      return make;
    }
  };
}
const targets = {
  frozen: () => Object.freeze([]),
  frozenFull: () => Object.freeze([9, 9]),
  sealed: () => Object.seal([9]),
  notExtensible: () => Object.preventExtensions([9.5]),
  readOnlyLength: () => Object.defineProperty([], "length", { writable: false }),
  readOnlyElement: () => Object.defineProperty([1, 2], 0, { writable: false }),
  fixedElement: () => Object.defineProperty([1, 2], 0, { configurable: false, writable: false }),
  accessorElement: () => Object.defineProperty([1, 2], 1, { get() { return 7; }, configurable: true }),
  plainObject: () => ({}),
  objectWithElements: () => ({ 0: "x", 1: "y" }),
  text: () => new String("ab"),
  textWithElements: () => Object.assign(new String("ab"), { 5: "z" }),
  typedArray: () => new Float64Array(3),
  doubles: () => [0.5, 1.5],
  int32s: () => [7, 8, 9],
  argumentsObject: () => (function () { return arguments; })(1, 2),
  proxy: () => new Proxy([], { defineProperty(target, key, descriptor) { lines.push(`define ${String(key)}`); return Reflect.defineProperty(target, key, descriptor); } }),
};
for (const [name, make] of Object.entries(targets)) {
  const Class = species(function () { return make(); });
  attempt(`into ${name}`, () => {
    const result = Class.from([1, 2]).flatMap(x => [x + 0.5, "s"]);
    return [Object.prototype.toString.call(result), Object.getOwnPropertyNames(result).join(), show(Object.getOwnPropertyDescriptor(result, "0")), show(Object.getOwnPropertyDescriptor(result, "1"))];
  });
  attempt(`filter into ${name}`, () => {
    const result = Class.from([1, 2]).filter(() => true);
    return [Object.getOwnPropertyNames(result).join(), show(Object.getOwnPropertyDescriptor(result, "0"))];
  });
}

class List extends Array {
  [0] = "first";
  [2] = 2.5;
}
attempt("fields by index", () => describe(new List()));
attempt("fields by index over elements", () => describe(new List(4)));

attempt("array-like", () => describe(Array.prototype.flatMap.call({ length: 3, 0: "a", 2: [1.5, 2.5] }, x => x)));
attempt("huge array-like", () => {
  let calls = 0;
  const like = new Proxy({ length: 2 ** 40 }, { has(_, key) { if (++calls > 3) throw new RangeError("enough"); return false; } });
  return Array.prototype.flatMap.call(like, x => x);
});
attempt("source shrinks", () => { const a = [1.5, 2.5, 3.5, 4.5]; return describe(a.flatMap(x => { a.length = 2; return [x]; })); });
attempt("source changes kind", () => { const a = [1.5, 2.5, 3.5]; return describe(a.flatMap((x, i) => { a[i + 1] = "text"; return [x, x]; })); });
attempt("part changes while it is read", () => {
  const part = [1.5, 2.5, 3.5];
  Object.defineProperty(part, 1, { get() { part.length = 2; return "got"; }, configurable: true });
  return describe([0].flatMap(() => part));
});
attempt("this argument", () => [1, 2].flatMap(function (x) { return [x * this.k]; }, { k: 1.5 }));
attempt("no function", () => [1].flatMap(1));
attempt("null", () => Array.prototype.flatMap.call(null, x => x));

console.log(lines.join("\n"));

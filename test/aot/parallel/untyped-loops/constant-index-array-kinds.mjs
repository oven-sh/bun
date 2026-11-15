const read = [a => a[0], a => a[1], a => a[2], a => a[5], a => a[9], a => a[40]];
const write = [(a, v) => { a[0] = v; }, (a, v) => { a[1] = v; }, (a, v) => { a[2] = v; }, (a, v) => { a[5] = v; }, (a, v) => { a[9] = v; }, (a, v) => { a[40] = v; }];
const update = [a => { a[0] += 1; }, a => { a[1] *= 0.5; }, a => { a[2]--; }, a => { a[5] -= 3; }, a => { a[9]++; }, a => { a[40] += 0.5; }];
const add = (a, b) => { a[0] += b[0]; a[1] += b[1]; a[2] += b[2]; return a[2] > 1e6 ? (a[2] = 0) : 1; };
const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const exchange = a => { const t = a[0]; a[0] = a[2]; a[2] = t; };

let heard = 0;
class Derived extends Array {}
const length = process.argv.length > 99 ? 4 : 3;
const int32s = () => Array.from({ length }, (_, i) => i + 1);
const doubles = () => Array.from({ length }, (_, i) => i + 0.5);
const texts = () => Array.from({ length }, (_, i) => "t" + i);
const kinds = {
  int32s,
  doubles,
  texts,
  literalInt32s: () => [1, 2, 3],
  literalDoubles: () => [0.5, 1.5, 2.5],
  literalTexts: () => ["a", "b", "c"],
  literalMixed: () => [1, 2.5, "c", null, undefined, -0],
  empty: () => [],
  undecided: () => new Array(length),
  largeUndecided: () => new Array(64),
  int32Hole: () => { const a = int32s(); delete a[1]; return a; },
  doubleHole: () => { const a = doubles(); delete a[1]; return a; },
  textHole: () => { const a = texts(); delete a[0]; return a; },
  longInt32s: () => Array.from({ length: 48 }, (_, i) => i),
  longDoubles: () => Array.from({ length: 48 }, (_, i) => i / 4),
  negativeZeros: () => [-0, 0.5, -0],
  limits: () => [2147483647, -2147483648, 4294967295],
  nans: () => [NaN, 1.5, Infinity],
  frozenInt32s: () => Object.freeze(int32s()),
  frozenDoubles: () => Object.freeze(doubles()),
  sealedDoubles: () => Object.seal(doubles()),
  closedDoubles: () => Object.preventExtensions(doubles()),
  readOnlyLength: () => Object.defineProperty(doubles(), "length", { writable: false }),
  readOnlyElement: () => Object.defineProperty(doubles(), 1, { writable: false }),
  accessorElement: () => Object.defineProperty(doubles(), 1, { get: () => (heard++, 7), set: value => { heard += 10; } }),
  derived: () => Derived.from(doubles()),
  derivedInt32s: () => Derived.from(int32s()),
  float64s: () => new Float64Array([0.5, 1.5, 2.5]),
  int32View: () => new Int32Array([1, 2, 3]),
  bytes: () => new Uint8Array([1, 2, 255]),
  bigints: () => new BigInt64Array([1n, 2n, 3n]),
  detached: () => { const view = new Float64Array(4); structuredClone(view.buffer, { transfer: [view.buffer] }); return view; },
  text: () => "abc",
  textObject: () => new String("abc"),
  object: () => ({ 0: 1, 1: 2.5, 2: "c" }),
  arguments: () => (function () { return arguments; })(1, 2.5, "c"),
  callable: () => Object.assign(() => 1, { 0: 1, 1: 2 }),
  proxy: () => new Proxy(doubles(), { get: (target, key) => (heard++, target[key]), set: (target, key, value) => ((heard += 100), (target[key] = value), true) }),
  inherited: () => Object.create(doubles()),
  ownPrototype: () => Object.setPrototypeOf(doubles(), { 5: "above", get 9() { heard++; return 9; }, set 40(value) { heard += 1000; } }),
  undefined: () => undefined,
  null: () => null,
  number: () => 5,
  global: () => globalThis,
};
const values = [7, 0.25, NaN, -0, Infinity, 2147483648, -2147483648, "text", undefined, null, true, { valueOf: () => 3 }, 12n, Symbol.iterator];
const show = value => (typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : typeof value === "string" ? '"' + value + '"' : typeof value === "object" && value !== null ? "object" : typeof value === "function" ? "function" : String(value));
const attempt = run => {
  try {
    return show(run());
  } catch (error) {
    return error.name;
  }
};
const contents = a => {
  if (a === globalThis || a === null || a === undefined) return "";
  const parts = [];
  for (const index of [0, 1, 2, 3, 4, 5, 9, 40]) parts.push(index in Object(a) ? attempt(() => a[index]) : "-");
  return parts.join() + ":" + attempt(() => a.length);
};

function test(name) {
  const make = kinds[name];
  const line = [];
  for (const run of read) line.push(attempt(() => run(make())));
  for (const run of update) {
    const a = make();
    line.push(attempt(() => run(a)) + contents(a));
  }
  for (let place = 0; place < write.length; place++)
    for (const value of values) {
      const a = make();
      line.push(attempt(() => write[place](a, value)) + contents(a));
    }
  for (const other of [int32s, doubles, texts, kinds.doubleHole]) {
    const a = make();
    line.push(attempt(() => add(a, other())) + contents(a), attempt(() => same(make(), other())), attempt(() => add(a, a)) + contents(a), attempt(() => same(a, a)));
    for (let turn = 0; turn < 6; turn++) attempt(() => add(a, a));
    line.push(contents(a), attempt(() => exchange(a)) + contents(a));
  }
  return line.join(" ");
}

for (const name in kinds) console.log(name, test(name), heard);

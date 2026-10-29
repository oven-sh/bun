// Each built-in that has a stub of its own for boxed operands, named where it is called, on every kind of receiver and operand: the ones the stub serves,
// the ones it leaves to the function, and the ones that make the function throw.
class List extends Array {}
class Table extends Map {}
class Bag extends Set {}
// Frozen: every call gets fresh receivers, and this one object, which the weak tables hold, stays as it is.
const key = Object.freeze({ name: "key" });
function kinds() {
  const weakTable = new WeakMap([[key, "held"]]);
  const weakBag = new WeakSet([key]);
  return [
    undefined, null, true, false, 0, -0, 1, 1.5, NaN, Infinity, "", "  ab,Cd  ", "abc", "a", Symbol.iterator, 10n,
    {}, key, Object.create(null), { length: 2, 0: "a", 1: "b" }, [], [1, "a", NaN, key], [, 1], new List(3, "a"), Object.create(Array.prototype),
    new Map([["a", 1], [key, 2], [NaN, 3]]), new Table([["a", 1]]), Object.create(Map.prototype), new Set(["a", key, NaN]), new Bag(["a"]), weakTable, weakBag,
    new Uint8Array([1, 2, 3]), new Float64Array(2), new DataView(new ArrayBuffer(4)), function named(a, b) {}, () => 1, new Proxy([1], {}), new Proxy({}, {}),
    new Date(0), /a/g, new Error("e"), Promise.resolve(1), new String(" x "), new Number(NaN), Object(1n),
  ];
}
function show(value) {
  if (value === undefined || value === null || typeof value === "boolean") return String(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "function") return "function " + value.name + "/" + value.length;
  const tag = Object.prototype.toString.call(value).slice(8, -1);
  if (Array.isArray(value)) return tag + "(" + value.length + ")";
  return tag;
}
function attempt(run) {
  try {
    return show(run());
  } catch (error) {
    return "!" + error.constructor.name;
  }
}
const operands = [undefined, null, 0, 1, -1, NaN, "a", "", key, [1]];
const calls = {
  includes: (r, a) => Array.prototype.includes.call(r, a),
  indexOf: (r, a) => Array.prototype.indexOf.call(r, a),
  isArray: r => Array.isArray(r),
  push: (r, a) => Array.prototype.push.call(r, a),
  slice0: r => Array.prototype.slice.call(r),
  slice1: (r, a) => Array.prototype.slice.call(r, a),
  slice2: (r, a) => Array.prototype.slice.call(r, 0, a),
  bind0: r => Function.prototype.bind.call(r),
  bind1: (r, a) => Function.prototype.bind.call(r, a),
  bind3: (r, a) => Function.prototype.bind.call(r, a, 1, 2),
  bind5: (r, a) => Function.prototype.bind.call(r, a, 1, 2, 3, 4),
  isNaN: r => isNaN(r),
  stringify1: r => JSON.stringify(r),
  stringify2: (r, a) => JSON.stringify(r, a),
  mapDelete: (r, a) => Map.prototype.delete.call(r, a),
  mapGet: (r, a) => Map.prototype.get.call(r, a),
  mapHas: (r, a) => Map.prototype.has.call(r, a),
  mapSet: (r, a) => Map.prototype.set.call(r, a, 1),
  getPrototypeOf: r => Object.getPrototypeOf(r) === null ? "none" : Object.getPrototypeOf(r) === Object.getPrototypeOf(Object(r)),
  is: (r, a) => Object.is(r, a),
  setPrototypeOf: (r, a) => Object.setPrototypeOf(r, a) === r,
  setAdd: (r, a) => Set.prototype.add.call(r, a),
  setDelete: (r, a) => Set.prototype.delete.call(r, a),
  setHas: (r, a) => Set.prototype.has.call(r, a),
  stringIndexOf: (r, a) => String.prototype.indexOf.call(r, a),
  stringSlice1: (r, a) => String.prototype.slice.call(r, a),
  stringSlice2: (r, a) => String.prototype.slice.call(r, 1, a),
  startsWith: (r, a) => String.prototype.startsWith.call(r, a),
  toLowerCase: r => String.prototype.toLowerCase.call(r),
  trim: r => String.prototype.trim.call(r),
  weakMapGet: (r, a) => WeakMap.prototype.get.call(r, a),
  weakMapHas: (r, a) => WeakMap.prototype.has.call(r, a),
  weakMapSet: (r, a) => WeakMap.prototype.set.call(r, a, 1),
  weakSetHas: (r, a) => WeakSet.prototype.has.call(r, a),
  mapSize: r => Reflect.get(Map.prototype, "size", r),
  setSize: r => Reflect.get(Set.prototype, "size", r),
  viewLength: r => Reflect.get(Object.getPrototypeOf(Uint8Array.prototype), "length", r),
};
for (const name of Object.keys(calls)) {
  const call = calls[name];
  const count = kinds().length;
  const lines = [];
  for (let which = 0; which < count; which++) {
    const answers = [];
    // A fresh receiver for each call: some of the calls change it.
    for (const operand of call.length > 1 ? operands : [undefined]) answers.push(attempt(() => call(kinds()[which], operand)));
    lines.push(answers.join(" "));
  }
  console.log(name + ": " + lines.join(" | "));
}

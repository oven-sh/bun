// from() of each kind of view over sets, maps, iterators, lists and others, with and without a mapper: values that are converted, classes below, iterators half stepped, closed and shared.
const lines = [];
const show = value => value === undefined ? "undefined" : ArrayBuffer.isView(value) ? value.constructor.name + "[" + Array.from(value, String).join() + "]" : String(value);
const attempt = (name, make) => { try { lines.push(name + " " + show(make())); } catch (error) { lines.push(name + " " + error.constructor.name + " " + error.message); } };
let order = "";
const converted = name => ({ valueOf() { order += name; return name.charCodeAt(0); } });
class Sub extends Uint8Array { constructor(...args) { order += "new" + args.length + typeof args[0]; super(...args); } }
class Mapped extends Set { *[Symbol.iterator]() { order += "own"; yield 9; yield 8; } }
const views = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, Sub];
const map = new Map([[1, 10], [2, 20.5], [300, "7"]]);
const stepped = () => { const it = [5, 6, 7].values(); it.next(); return it; };
const closed = () => { const it = new Set([1]).values(); it.next(); it.next(); return it; };
const sources = {
  set: () => new Set([1, 2, 300, -1]), doubles: () => new Set([0.5, 1.5, NaN]), texts: () => new Set(["1", "x", "2.5"]), bigs: () => new Set([1n, 2n]), mixed: () => new Set([1, "2", null, undefined, true]), empty: () => new Set(), objects: () => new Set([converted("a"), converted("b")]),
  values: () => map.values(), keys: () => map.keys(), entries: () => map.entries(), map: () => map, list: () => [1, 2, 3].values(), listKeys: () => ["a", "b"].keys(), listEntries: () => [4].entries(), holes: () => [1, , 3].values(), stepped, closed, setEntries: () => new Set([4]).entries(),
  generator: function* () { order += "g"; yield 1; yield 2; }, own: () => new Mapped([1]), array: () => [1, 2.5, "3"], arrayHoles: () => [1, , 3], arrayObjects: () => [converted("c")], view: () => new Float32Array([1.5, 2.5]), text: () => "123", like: () => ({ length: 2, 0: 5, 1: converted("d") }), next: () => ({ [Symbol.iterator]: () => ({ n: 0, next() { return { done: this.n > 1, value: this.n++ }; } }) }), arguments: () => (function () { return arguments; })(7, 8), symbol: () => new Set([Symbol("s")]), nothing: () => null, number: () => 5,
};
for (let turn = 0; turn < 2; turn++) {
  for (const view of views) {
    for (const [name, make] of Object.entries(sources)) {
      attempt(view.name + " " + name, () => view.from(make()));
      attempt(view.name + " " + name + " undefined", () => view.from(make(), undefined, 5));
      attempt(view.name + " " + name + " mapped", () => view.from(make(), function (value, k) { return view === BigInt64Array || view === BigUint64Array ? BigInt(k) : k + this.add; }, { add: 2 }));
    }
    attempt(view.name + " not callable", () => view.from(new Set([1]), 5));
  }
}
lines.push(order.length + " " + order.slice(0, 200));
function loops(turns) { let r = 0; const set = new Set([1, 2, 3]); for (let j = 0; j < turns; j++) { const view = Uint8Array.from(set); r += view.length + view[view.length - 1]; r += Float64Array.from(map.values()).length; r += Int32Array.from([j, 2].values())[0]; if (j === 4) set.add(j * 10); if (j === 6) set.delete(1); if (j === 8) set.clear(); if (j === 9) set.add("5"); } return r; }
lines.push(String(loops(12)));
const shared = [1, 2, 3, 4].values();
lines.push(show(Uint8Array.from(shared)) + show(Uint8Array.from(shared)) + JSON.stringify(shared.next()));
const taken = new Set([1, 2, 3]).values(); taken.next();
lines.push(show(Uint8Array.from(taken)) + JSON.stringify(taken.next()));
const keys = map.keys(); lines.push(show(Uint16Array.from(keys)) + JSON.stringify(keys.next()));
const named = new Set([1, 2]); named[Symbol.iterator] = function* () { yield 7; }; attempt("named", () => Uint8Array.from(named));
attempt("call", () => Uint8Array.from.call(Array, new Set([1])));
attempt("call object", () => Uint8Array.from.call(Object, new Set([1])));
attempt("call short", () => Uint8Array.from.call(class { constructor() { return new Uint8Array(1); } }, new Set([1, 2])));
attempt("call nothing", () => Uint8Array.from.call(undefined, new Set([1])));
attempt("abstract", () => Object.getPrototypeOf(Uint8Array).from(new Set([1])));
for (const line of lines) console.log(line);

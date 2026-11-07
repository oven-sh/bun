// Literals with computed keys, each made many times so that the definition by key is answered from what the first objects left behind: keys that are names of the literal's own fields (in front of them and behind them), "__proto__", indexes and texts that look like indexes, symbols, numbers, objects with toString, keys that repeat, accessors and read-only properties of the same name on the object above, many different keys, and what is done to the object afterwards.
const own = Symbol("own");
const keys = ["a", "b", "id", "label", "__proto__", "constructor", "toString", "0", "1", "01", "-1", "4294967294", "4294967295", "1.5", "", " ", "length", own, Symbol.iterator, Symbol.toStringTag, 7, -0, 1e21, null, undefined, true, 12n, { toString() { return "made"; } }, ["x", "y"]];
function show(o) {
  return JSON.stringify(Reflect.ownKeys(o).map(String)) + " " + JSON.stringify(o) + " " + (Object.getPrototypeOf(o) === Object.prototype) + " " + Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return (d.writable ? "w" : "-") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-"); }).join("");
}
const makers = {
  between: (k, v) => ({ id: 1, [k]: v, label: "z" }),
  first: (k, v) => ({ [k]: v, id: 1, label: "z" }),
  last: (k, v) => ({ id: 1, label: "z", [k]: v }),
  alone: (k, v) => ({ [k]: v }),
  twice: (k, v) => ({ [k]: v, id: 1, [k]: v + 1 }),
  two: (k, v) => ({ id: 1, [k]: v, ["other"]: v, label: "z" }),
  behindSpread: (k, v) => ({ ...{ p: 1, id: 5 }, [k]: v, id: 2 }),
  method: (k, v) => ({ id: 1, [k]() { return v; } }),
  getter: (k, v) => ({ id: 1, get [k]() { return v; }, label: "z" }),
};
for (const name in makers) {
  for (const k of keys) {
    let last = "";
    for (let round = 0; round < 40; round++) last = show(makers[name](k, round));
    console.log(name, String(typeof k === "symbol" ? k.toString() : k), last);
  }
}
const above = Object.defineProperties({}, { guarded: { set(v) { throw new Error("the setter ran"); }, get() { return "inherited"; } }, fixed: { value: 1, writable: false } });
const below = (k, v) => ({ __proto__: above, id: 1, [k]: v, label: "z" });
for (const k of ["guarded", "fixed", "free"]) { let last = ""; for (let round = 0; round < 40; round++) { const o = below(k, round); last = JSON.stringify(Reflect.ownKeys(o)) + JSON.stringify(o) + o.guarded + o.fixed; } console.log("above", k, last); }
let sum = 0;
for (let round = 0; round < 3; round++) for (let i = 0; i < 3000; i++) { const o = makers.between("k" + i, i); sum += o["k" + i] + Object.keys(o).length; }
console.log(sum);
for (let round = 0; round < 40; round++) {
  const o = makers.between("a", round); o.later = 1; delete o.a; o.a = 2; o.b = 3;
  const f = Object.freeze(makers.between("a", round)); let refused = false; try { "use strict"; f.a = 5; } catch { refused = true; }
  if (round === 39) console.log(show(o), show(f), refused, f.a);
}
class Base { constructor(k) { return { id: 1, [k]: this.constructor.name, label: "z" }; } } class Heir extends Base {}
for (let round = 0; round < 40; round++) if (round === 39) console.log(show(new Base("a")), show(new Heir("b")));

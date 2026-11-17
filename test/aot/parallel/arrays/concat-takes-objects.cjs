// [].concat(x), list.concat(x) of objects that are no lists: one element, unless Symbol.isConcatSpreadable says otherwise anywhere.
const log = (...words) => console.log(...words);
class Node { constructor(type) { this.type = type; } get kind() { return "kind"; } }
class Spread { constructor(...items) { this.length = items.length; items.forEach((item, i) => this[i] = item); } get [Symbol.isConcatSpreadable]() { return true; } }
class Heir extends Array {}
class Own extends Map {}
const proto = Object.create({ [Symbol.isConcatSpreadable]: true }, { length: { value: 2 } });
const seen = [];
const proxy = new Proxy([1, 2], { get(target, key) { seen.push(String(key)); return target[key]; } });
const getter = { length: 1, 0: "g", get [Symbol.isConcatSpreadable]() { seen.push("getter"); return true; } };
const throws = { get [Symbol.isConcatSpreadable]() { throw new RangeError("asked"); } };
const values = {
  node: new Node("a"), literal: { length: 2, 0: "x", 1: "y" }, spread: new Spread("p", "q"), heir: Heir.from([7, 8]), map: new Map([[1, 2]]), own: new Own(), date: new Date(5), regexp: /a/g,
  function: function f() {}, arrow: () => 1, class: Node, error: new Error("e"), nothing: Object.create(null), proto, proxy, getter, throws, typed: new Uint8Array(2), buffer: new ArrayBuffer(2),
  list: [1, [2]], empty: [], holes: [, 1, , 2], doubles: [1.5, 2.5], string: "text", object: new String("boxed"), symbol: Symbol("s"), bigint: 10n, undefined, null: null, number: 1.5, nan: NaN, boolean: true,
  frozen: Object.freeze({ a: 1 }), marked: { [Symbol.isConcatSpreadable]: undefined }, off: Object.assign([1, 2], { [Symbol.isConcatSpreadable]: false }), arguments: (function () { return arguments; })(1, 2),
};
const show = x => typeof x === "symbol" ? x.toString() : typeof x === "object" && x !== null ? (Array.isArray(x) ? "[" + x.length + "]" : Object.prototype.toString.call(x)) : typeof x === "function" ? x.name : String(x) + typeof x;
function one(x) { return [].concat(x); }
function two(list, x) { return list.concat(x); }
function three(list, x, y) { return list.concat(x, y); }
for (const name of Object.keys(values)) {
  for (const [how, f] of [["one", x => one(x)], ["ints", x => two([1, 2], x)], ["doubles", x => two([0.5], x)], ["values", x => two(["a", {}], x)], ["holes", x => two([, 1], x)], ["heir", x => two(Heir.from([3]), x)], ["three", x => three([1], x, x)]]) {
    try { const made = f(values[name]); log(name, how, made.length, made.constructor.name, Object.keys(made).join(), made.map(show).join("|"), made.includes(values[name])); }
    catch (error) { log(name, how, error.constructor.name, error.message); }
  }
}
log(seen.join());
let nodes = [];
for (let i = 0; i < 200; i++) nodes = nodes.concat(i % 3 ? new Node("n" + i) : [new Node("l" + i)]);
log(nodes.length, nodes.every((node, i) => node.type.slice(1) === String(i)));
Object.defineProperty(Node.prototype, Symbol.isConcatSpreadable, { get() { seen.push("late"); return false; }, configurable: true });
log(one(values.node).length, seen.at(-1));

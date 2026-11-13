// Reads and stores under constant indexes, on both sides of 64, of every kind of receiver.
const lines = [];
const show = value => (value === undefined ? "undefined" : typeof value === "bigint" ? value + "n" : typeof value === "symbol" ? value.toString() : JSON.stringify(value));
function reads(list) { return [list[0], list[1], list[2], list[7], list[31], list[62], list[63], list[64], list[65], list[200]].map(show).join(" "); }
function stores(list, a, b) {
  list[0] = a; list[1] = b; list[5] = a; list[62] = b; list[63] = a; list[64] = b; list[70] = a;
  return list;
}
function sloppy(list, a, b) { list[0] = a; list[3] = b; list[63] = a; list[65] = b; return list; }
function strict(list, a, b) { "use strict"; list[0] = a; list[3] = b; list[63] = a; list[65] = b; return list; }
const attempt = (name, f) => { try { lines.push(name + " " + f()); } catch (error) { lines.push(name + " throws " + error.name); } };
const filled = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const kinds = {
  contiguous: () => filled(80, i => "s" + i), short: () => ["a", "b"], int32: () => filled(80, i => i), doubles: () => filled(80, i => i + 0.5), mixed: () => filled(80, i => (i & 1 ? i : "m" + i)),
  holes: () => { const a = new Array(80); a[1] = "one"; a[63] = "last"; return a; }, empty: () => [], constant: () => [1, 2, 3], strings: () => ["x", "y", "z"], sparse: () => { const a = []; a[100000] = 1; a[0] = "z"; return a; },
  frozen: () => Object.freeze(filled(80, i => i)), sealed: () => Object.seal(filled(3, i => "q" + i)), closed: () => Object.preventExtensions(["p"]),
  typed: () => new Uint8Array(filled(80, i => i)), floats: () => new Float64Array(filled(80, i => i / 2)), bigints: () => new BigInt64Array(filled(80, BigInt)), small: () => new Int16Array(4),
  object: () => ({ 0: "o0", 1: "o1", 63: "o63", 64: "o64" }), bare: () => Object.create(null), text: () => "abcdefgh", arguments: () => (function () { return arguments; })(1, 2, 3), mapped: () => (function (a, b) { a = 9; return arguments; })(1, 2),
  proxy: () => new Proxy([1, 2, 3], { get: (t, k) => "got " + String(k), set: (t, k, v) => { lines.push("set " + String(k)); t[k] = v; return true; } }),
  below: () => Object.create(["u0", "u1"]), accessor: () => Object.defineProperty([1, 2, 3], 1, { get() { return "getter"; }, set(v) { lines.push("setter " + show(v)); }, configurable: true }),
  subclass: () => new (class List extends Array {})(3).fill("f"), map: () => new Map([[0, 1]]), number: () => 5, boolean: () => true, nothing: () => undefined, none: () => null, symbol: () => Symbol.iterator, fn: () => function f(a, b) {},
};
for (let round = 0; round < 3; ++round) {
  for (const name of Object.keys(kinds)) {
    attempt("read " + name, () => reads(kinds[name]()));
    for (const [a, b] of [["A", "B"], [1, 2.5], [{ x: 1 }, undefined], [-0, NaN]]) {
      attempt("store " + name, () => reads(stores(kinds[name](), a, b)));
      attempt("sloppy " + name, () => reads(sloppy(kinds[name](), a, b)));
      attempt("strict " + name, () => reads(strict(kinds[name](), a, b)));
    }
  }
}
function memo(cells, a, b) {
  let first, second;
  if (cells[0] !== a) { first = { a }; cells[0] = a; cells[1] = first; } else first = cells[1];
  if (cells[2] !== b || cells[1] !== first) { second = [first, b]; cells[2] = b; cells[3] = second; } else second = cells[3];
  return second;
}
const cells = new Array(4).fill(Symbol.for("sentinel"));
let last, same = 0;
for (let i = 0; i < 30000; ++i) { const made = memo(cells, i >> 4, i >> 2); if (made === last) ++same; last = made; }
lines.push("memo " + same + " " + show(last));
const between = Object.defineProperty(Object.create(Array.prototype), 2, { get() { return "from the prototype"; }, set(v) { lines.push("prototype setter " + show(v)); }, configurable: true });
attempt("holes below a getter", () => reads(Object.setPrototypeOf(new Array(5), between)));
attempt("stores below a setter", () => { const list = Object.setPrototypeOf([], between); list[0] = 1; list[2] = 2; return show(list.length) + reads(list); });
console.log(lines.join("\n"));

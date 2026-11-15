// o[k] in text made at run time where k is a symbol and the property is the object's own: at sites that see many shapes and symbols; in the cell and beside it; of objects that become dictionaries, are listed and gain and lose the
// property; of values that become accessors; below prototypes that have it too; of shapes and symbols that die between collections, whose places others take.
const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0];
const shared = Symbol("of the program");
class Compiled { constructor(v) { this.a = v; this[shared] = "c" + v; } }
const program = { collect: full => globalThis.Bun?.gc?.(full), shared, Compiled, object: { [shared]: "of an object", b: 1 }, make: v => ({ b: v, [shared]: v }) };
const text = `
const lines = [], { shared, collect } = program;
const show = v => v === undefined ? "u" : typeof v === "symbol" ? "s" : typeof v === "function" ? "f" : typeof v === "object" && v ? "{" + Object.keys(v) + "}" : String(v);
const tell = (name, f) => { let r; try { r = show(f()); } catch (e) { r = "!" + (e?.message ?? e); } lines.push(name + " " + r); };
const read = (o, k) => o[k], twice = (o, k) => show(o[k]) + show(o[k]), optional = (o, k) => o?.[k], constant = o => o[shared], called = (o, k) => typeof o[k] === "function" ? o[k](1) : o[k];
const symbols = []; for (let i = 0; i < 12; i++) symbols.push(i % 3 ? Symbol("s" + i) : Symbol.for("for" + i));
symbols.push(shared, Symbol.iterator, Symbol.toStringTag);
// Shapes by the number of names in front of the symbol: the value lies in the cell, then beside it, behind each growth.
const filled = (n, k, v) => { const o = {}; for (let i = 0; i < n; i++) o["p" + i] = i; o[k] = v; return o; };
const objects = {};
for (let n = 0; n < 70; n += n < 10 ? 1 : 12) objects["filled" + n] = filled(n, symbols[n % 12], "v" + n);
for (let n = 0; n < 12; n++) objects["literal" + n] = { a: n, [symbols[n]]: "l" + n, [symbols[(n + 5) % 12]]: () => "m" + n, [shared]: n + .5 };
class A { constructor(v) { this.v = v; this[symbols[0]] = "a" + v; } get [symbols[1]]() { return "getter" + this.v; } [symbols[2]]() { return "method" + this.v; } static [symbols[3]] = "static"; }
class B extends A { constructor(v) { super(v); try { this[symbols[1]] = 1; } catch { this.caught = 1; } this.w = v; this[symbols[4]] = "b" + v; } }
const make = n => class M extends A { constructor(v) { super(v); this["m" + n] = v; this[symbols[2]] = "own" + n; } [shared] = "field" + n; };
Object.assign(objects, { a: new A(1), b: new B(2), m1: new (make(1))(3), m2: new (make(2))(4), class_: A, compiled: new program.Compiled(5), object: program.object, made: program.make(6), bare: Object.assign(Object.create(null), { [symbols[0]]: "bare", x: 1 }),
  heir: Object.assign(Object.create({ [symbols[0]]: "above", [symbols[6]]: "above" }), { [symbols[6]]: "own" }), list: Object.assign([1, 2], { [symbols[0]]: "of a list" }), fn: Object.assign(() => 1, { [symbols[0]]: "of a function" }), map: Object.assign(new Map(), { [symbols[0]]: "of a Map" }),
  frozen: Object.freeze({ [symbols[0]]: "frozen", a: 1 }), sealed: Object.seal({ [symbols[0]]: "sealed" }), proxy: new Proxy({ [symbols[0]]: "behind" }, {}), text: "abc", number: 5, bool: true, wrapped: Object("xy"), args: (function () { arguments[symbols[0]] = "args"; return arguments; })(1) });
const all = turn => { for (const [name, o] of Object.entries(objects)) for (let j = 0; j < symbols.length; j++) { const k = symbols[j]; tell(turn + name + j, () => twice(o, k)); tell(turn + name + j, () => optional(o, k)); if (j === 12) tell(turn + name, () => constant(o)); if (j < 4) tell(turn + name + j, () => called(o, k)); } };
for (let turn = 0; turn < 3; turn++) { all("t" + turn); if (turn) collect(turn === 2); }
// Values become accessors and values again, other values, are deleted and come back at other places; objects become dictionaries, are listed, and are read at the same sites.
const changing = (o, k) => {
  const seen = []; const look = () => { let s = ""; for (let i = 0; i < 3; i++) s += show(read(o, k)) + ","; seen.push(s); };
  look(); o[k] = "stored"; look(); Object.defineProperty(o, k, { get() { return "got" + this.q; }, configurable: true, enumerable: true }); look(); o.q = 1; look();
  Object.defineProperty(o, k, { value: "again", writable: true, configurable: true, enumerable: true }); look(); delete o[k]; look(); o.r = 2; o[k] = "back"; look(); delete o.q; delete o.a; look(); o.s = 3; o.t = 4; look();
  Object.keys(o).length; for (const n in o) seen.push(n); look(); for (let i = 0; i < 80; i++) o["d" + i] = i; look(); Object.keys(o); JSON.stringify(o); look(); delete o.d3; delete o.r; look(); o.r = "r2"; o[k] = "last"; look(); delete o[k]; look(); Object.setPrototypeOf(o, { [k]: "inherited" }); look(); Object.freeze(o); look();
  return seen.join(" ");
};
for (let n = 0; n < 24; n++) { const k = symbols[n % 12]; tell("changing" + n, () => changing(n % 2 ? { a: 1, [k]: "first" } : filled(n, k, "first"), k)); if (n % 7 === 6) collect(n % 2 === 0); }
for (let n = 0; n < 6; n++) { const k = symbols[n]; tell("heir changes" + n, () => { const p = { [k]: "p" }, o = Object.create(p), s = []; s.push(read(o, k), read(p, k)); o.x = 1; s.push(read(o, k)); o[k] = "o"; s.push(read(o, k), read(p, k)); delete p[k]; s.push(read(p, k)); delete o[k]; s.push(show(read(o, k))); return s.join(); }); }
// Shapes and symbols that live for a moment: what the next ones are called may have been called something else.
let wrong = 0, sum = 0;
for (let round = 0; round < 60; round++) {
  const k = Symbol("r" + round), list = [];
  for (let i = 0; i < 40; i++) { const o = {}; for (let j = 0; j < (i * 7 + round) % 11; j++) o["x" + round + "_" + i + "_" + j] = j; o[k] = round * 100 + i; o.after = i; if (i % 5 === 0) o["y" + round] = -1; list.push(o); }
  for (let pass = 0; pass < 3; pass++) for (let i = 0; i < 40; i++) { if (read(list[i], k) !== round * 100 + i) wrong++; if (read(list[i], shared) !== undefined) wrong++; sum = sum * 31 + read(list[i], k) | 0; }
  if (round % 4 === 3) collect(round % 8 === 3);
}
lines.push("short lives " + wrong + " " + sum);
// Many shapes and symbols in turn: entries displace each other.
const many = []; for (let i = 0; i < 400; i++) many.push(filled(i % 20, symbols[i % 12], i), { ["z" + i]: i, [symbols[i % 12]]: -i });
for (let pass = 0; pass < 4; pass++) { let s = 0; for (let i = 0; i < many.length; i++) s = s * 7 + read(many[i], symbols[(i >> 1) % 12]) | 0; lines.push("many " + s); if (pass === 1) collect(true); }
return lines.join("\\n");`;
console.log(new Function("program", hidden(text))(program));

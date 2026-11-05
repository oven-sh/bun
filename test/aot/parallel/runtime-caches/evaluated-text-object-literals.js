const lines = [];
function show(label, value) {
  lines.push(label + " " + JSON.stringify(value, (key, item) => (item === undefined ? "<undefined>" : typeof item === "function" ? "<function " + item.name + ">" : typeof item === "bigint" ? item + "n" : typeof item === "symbol" ? String(item) : item)));
}
function describe(object) {
  return [Reflect.ownKeys(object).map(String), Object.getOwnPropertyDescriptors(object), Object.getPrototypeOf(object) === Object.prototype];
}
function warm(label, text, ...operands) {
  const run = new Function("log", "a", "b", "c", text);
  let last;
  for (let turn = 0; turn < 12; turn++) {
    const log = [];
    try {
      last = [run(log, ...operands), log];
    } catch (error) {
      last = ["threw " + error, log];
    }
    if (turn === 0 || turn === 11) show(label + " turn " + turn, last);
  }
  return last[0];
}

warm("locals", "return { x: a, y: b, z: c };", 1, "two", [3]);
warm("constants", "return { n: 1, s: 'text', t: true, u: undefined, z: null, d: 1.5, big: 10n };");
warm("calls in order", "const f = name => (log.push(name), name); return { x: f('x'), y: f('y'), z: f('z') };");
warm("a later value assigns an earlier local", "let v = a; return { first: v, second: (v = b), third: v };", 1, 2);
warm("a later value increments an earlier local", "let v = a; return { first: v, second: v++, third: v, fourth: ++v, fifth: v };", 1);
warm("a later call changes an earlier local", "let v = a; const bump = () => { v += 10; return v; }; return { first: v, second: bump(), third: v };", 1);
warm("assigned to a variable that a value reads", "let v = { inner: a }; v = { outer: v, again: v }; return v;", 1);
warm("assigned to a parameter that a value reads", "a = { was: a, b }; return a;", 1, 2);
warm("nested", "return { x: { y: { z: a } }, list: [{ p: b }, { p: c }] };", 1, 2, 3);
warm("conditional values", "return { x: a ? b : c, y: a && b, z: a || c, w: a ?? b };", 0, 1, 2);
warm("a value throws", "const f = name => { log.push(name); if (name === 'y') throw new Error(name); return name; }; return { x: f('x'), y: f('y'), z: f('z') };");
warm("dead zone", "const o = { x: a, y: later }; const later = 1; return o;", 1);
warm("duplicate names", "return { x: a, y: b, x: c };", 1, 2, 3);
warm("duplicate names, calls", "const f = name => (log.push(name), name); return { x: f(1), x: f(2), y: f(3), x: f(4) };");
warm("index names", "return { 1: a, x: b, 0: c, '2': a, y: b };", 1, 2, 3);
warm("shorthand", "return { a, b, c };", 1, 2, 3);
warm("own __proto__ by shorthand", "const __proto__ = a; const o = { __proto__, x: b }; return [Object.keys(o), Object.getPrototypeOf(o) === Object.prototype, o.x];", { p: 1 }, 2);
warm("prototype by __proto__", "const o = { x: b, __proto__: a, y: c }; return [Object.keys(o), Object.getPrototypeOf(o) === a, o.p];", { p: 1 }, 2, 3);
warm("computed names", "return { x: a, [b]: b, y: c };", 1, "k", 3);
warm("spread", "return { x: a, ...b, y: c };", 1, { x: "spread", q: 2 }, 3);
warm("accessors", "const o = { x: a, get y() { return this.x + 1; }, set y(v) { this.x = v; }, z: c }; o.y = 5; return [o.y, Object.keys(o)];", 1, 2, 3);
warm("function names", "const o = { f: function () {}, g: () => {}, h() {}, k: class {}, named: function other() {} }; return [o.f.name, o.g.name, o.h.name, o.k.name, o.named.name];");
warm("methods with super", "const o = { __proto__: { m() { return 'above'; } }, x: a, m() { return super.m() + this.x; } }; return o.m();", 1);
warm("this and arguments", "return (function () { return { self: this, count: arguments.length, first: arguments[0] }; }).call(a, b, c);", "receiver", 2, 3);
warm("seventeen names", "return { p0: a, p1: b, p2: c, p3: a, p4: b, p5: c, p6: a, p7: b, p8: c, p9: a, p10: b, p11: c, p12: a, p13: b, p14: c, p15: a, p16: b };", 1, 2, 3);
warm("sixteen names", "return { p0: a, p1: b, p2: c, p3: a, p4: b, p5: c, p6: a, p7: b, p8: c, p9: a, p10: b, p11: c, p12: a, p13: b, p14: c, p15: a };", 1, 2, 3);
warm("one name", "return { only: a };", 1);
warm("no name", "return {};");
warm("as an argument", "const f = (o, p) => [o, p]; return f({ x: a }, { y: b, z: c });", 1, 2, 3);
warm("in a loop", "const list = []; for (let i = 0; i < 5; i++) list.push({ i, twice: i * 2, a }); return list;", 1);
warm("the object is a value of itself later", "const o = { x: a }; o.self = { holder: o, y: b }; return o.self.holder === o;", 1, 2);
warm("generator", "function* g() { const o = { x: yield 1, y: yield 2 }; return o; } const it = g(); it.next(); it.next(a); return it.next(b).value;", "first", "second");
warm("symbols, functions and holes as values", "return describe({ s: a, f: b, e: [, 1] });".replace("describe", "(o => [typeof o.s, typeof o.f, 0 in o.e])"), Symbol("s"), () => 1);

const make = new Function("a", "b", "return { x: a, y: b };");
for (let turn = 0; turn < 12; turn++) make(turn, turn);
show("descriptors", describe(make(1, 2)));
const grown = make(1, 2);
grown.z = 3;
delete grown.x;
grown.x = 4;
show("changed afterwards", describe(grown));
show("frozen", describe(Object.freeze(make(1, 2))));

const many = [];
for (let turn = 0; turn < 20000; turn++) many.push(make(turn, [turn]));
if (typeof Bun !== "undefined") Bun.gc(true);
let sum = 0;
for (const item of many) sum += item.x + item.y[0];
show("kept across collections", sum);

const wide = new Function("a", "let t0 = a" + Array.from({ length: 300 }, (_, i) => ", t" + (i + 1) + " = t" + i + " + 1").join("") + "; return { first: t0, middle: t150, last: t300 };");
for (let turn = 0; turn < 12; turn++) wide(turn);
show("registers beyond the short form", wide(1));
const manyNames = new Function("a", "const list = []; " + Array.from({ length: 300 }, (_, i) => "list.push({ n" + i + ": a, m" + i + ": " + i + " });").join(" ") + " return list;");
for (let turn = 0; turn < 12; turn++) manyNames(turn);
show("names beyond the short form", [manyNames(1)[0], manyNames(1)[299]]);

console.log(lines.join("\n"));

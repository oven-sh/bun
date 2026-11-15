// Objects that text evaluated at run time fills name by name and converts to numbers and strings: what converts them changes before, between and behind the conversions, on the objects and above them.
const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0], F = (...a) => new Function(...a.slice(0, -1), hidden(a[a.length - 1]));
const lines = [], attempt = f => { try { const v = f(); return typeof v === "symbol" ? "symbol" : typeof v === "bigint" ? v + "n" : typeof v + " " + (Object.is(v, -0) ? "-0" : String(v)); } catch (e) { return "!" + e.constructor.name + " " + e.message.slice(0, 60); } };
const makes = {
  valueOf: F("n", "return { valueOf() { return n; } };"),
  both: F("n", "return { valueOf() { return n; }, toString() { return 's' + n; } };"),
  string: F("n", "return { a: 1, toString() { return 's' + n; } };"),
  primitive: F("n", "return { [Symbol.toPrimitive](hint) { return hint + n; } };"),
  fields: F("n", "return { n, m: n + 1 };"),
  filled: F("n", "const o = {}; o.n = n; o.valueOf = function () { return this.n; }; o.late = 1; return o;"),
  table: F("n", "const o = {}; for (let i = 0; i < 12; i++) o['k' + i + '_' + (n & 1)] = i; o.valueOf = () => n; return o;"),
  deleted: F("n", "const o = { a: 1, b: 2, valueOf() { return n; } }; delete o.a; o.c = 3; return o;"),
  nothing: F("n", "const o = Object.create(null); o.valueOf = () => n; return o;"),
  heir: F("n", "class A { valueOf() { return n; } } class B extends A { constructor() { super(); this.x = n; } } return new B();"),
  made: F("n", "const o = Object.create({ valueOf() { return n; } }); o.x = 1; return o;"),
  bare: F("n", "const o = Object.create(null); o.x = n; return o;"),
  array: F("n", "const o = [n, n + 1]; o.extra = 1; return o;"),
  fn: F("n", "const f = () => n; f.extra = 1; return f;"),
  date: F("n", "const d = new Date(n); d.extra = 1; return d;"),
  accessor: F("n", "return { get valueOf() { return () => n; }, get [Symbol.toPrimitive]() { return undefined; } };"),
  notCallable: F("n", "return { valueOf: 5, toString: 'x' };"),
  badPrimitive: F("n", "return { [Symbol.toPrimitive]: 5 };"),
  objects: F("n", "return { valueOf() { return {}; }, toString() { return {}; } };"),
  tagged: F("n", "return { n, get [Symbol.toStringTag]() { return 'Tag' + n; } };"),
};
const conversions = { plus: F("o", "return +o;"), add: F("o", "return o + 1;"), text: F("o", "return `${o}`;"), key: F("o", "return ({ 5: 'five', s5: 'text five' })[o];"), less: F("o", "return o < 6;"), equal: F("o", "return o == 5;"), bits: F("o", "return o | 0;"), string: F("o", "return String(o);"), number: F("o", "return Number(o);"), big: F("o", "return BigInt(o);"), date: F("o", "return new Date(o).getTime();"), json: F("o", "return JSON.stringify(o);"), tag: F("o", "return Object.prototype.toString.call(o);"), concat: F("o", "return 'a'.concat(o);"), join: F("o", "return [o, 1].join();") };
for (const [name, make] of Object.entries(makes)) for (const [how, convert] of Object.entries(conversions)) {
  const o = make(5), out = [];
  for (let i = 0; i < 4; i++) out.push(attempt(() => convert(o)));
  attempt(() => { o.later = 1; }); out.push(attempt(() => convert(o)));
  attempt(() => { o.valueOf = () => 77; }); out.push(attempt(() => convert(o)), attempt(() => convert(o)));
  attempt(() => { o[Symbol.toPrimitive] = h => h === "number" ? 88 : "p88"; }); out.push(attempt(() => convert(o)), attempt(() => convert(o)));
  attempt(() => { delete o[Symbol.toPrimitive]; }); out.push(attempt(() => convert(o)));
  attempt(() => { delete o.valueOf; }); out.push(attempt(() => convert(o)), attempt(() => convert(o)));
  attempt(() => { o.toString = () => "t99"; }); out.push(attempt(() => convert(o)));
  attempt(() => { delete o.toString; delete o.later; }); out.push(attempt(() => convert(o)));
  attempt(() => { Object.setPrototypeOf(o, { valueOf() { return 66; }, [Symbol.toPrimitive]: null }); }); out.push(attempt(() => convert(o)), attempt(() => convert(o)));
  lines.push(name + " " + how + ": " + [...new Set(out)].length + " " + out.join("; ") + " | " + attempt(() => Object.keys(o).join()));
}
// What lies above the objects gains and loses what converts.
const root = { kind: "root" }, middle = Object.create(root);
const below = F("root", "n", "const o = Object.create(root); o.a = n; o.b = n + 1; return o;"), classes = F("root", "class C { constructor(n) { this.n = n; this.m = n; } } Object.setPrototypeOf(C.prototype, root); return [1, 2].map(n => new C(n));");
const kept = [...Object.values(makes).map(make => make(3)), below(root, 1), below(middle, 2), below(middle, 3), ...classes(middle), Object.setPrototypeOf({ x: 1 }, root)];
const all = F("list", "return list.map(o => { try { return String(+o); } catch (e) { return e.constructor.name; } }).join();"), texts = F("list", "return list.map(o => { try { return `${o}`; } catch (e) { return e.constructor.name; } }).join('|');");
const report = name => lines.push(name + ": " + all(kept) + " / " + texts(kept));
report("before"); report("again");
root[Symbol.toPrimitive] = function (hint) { return hint === "number" ? 1000 : "from above"; }; report("gained"); report("gained again");
delete root[Symbol.toPrimitive]; report("lost"); report("lost again");
root.valueOf = function () { return 2000; }; report("valueOf"); middle.valueOf = function () { return 3000; }; report("valueOf between"); delete root.valueOf; report("valueOf lost"); delete middle.valueOf; report("both lost");
root.toString = function () { return "other text"; }; report("toString"); delete root.toString; report("toString lost");
Object.defineProperty(middle, Symbol.toPrimitive, { get() { return h => "getter " + h; }, configurable: true }); report("getter"); delete middle[Symbol.toPrimitive]; report("getter lost");
Object.setPrototypeOf(middle, { valueOf: () => 4000 }); report("other root"); Object.setPrototypeOf(middle, null); report("no root"); Object.setPrototypeOf(middle, root); report("root again");
// Loops over one object, and over many that are made in them.
const loop = F("make", "n", "const o = make(4); let s = 0; for (let i = 0; i < n; i++) { s += +o; if (i === 150) o.more = i; if (i === 200) delete o.more; if (i === 250) o.valueOf = () => 9; } return s;");
const loopOfMany = F("make", "n", "let s = 0; for (let i = 0; i < n; i++) { const o = make(i & 7); s += +o; o.w = i; s += +o; } return s;");
for (const [name, make] of Object.entries(makes)) lines.push(name + " in loops: " + attempt(() => loop(make, 300)) + " " + attempt(() => loopOfMany(make, 300)));
// Filled while a conversion of it runs.
const during = F("o", "let n = 0; o.valueOf = function () { n++; this['n' + n] = n; if (n > 6) delete this['n' + (n - 6)]; return n; }; let s = 0; for (let i = 0; i < 40; i++) s += o + 1; return [s, Object.keys(o).join()].join(' ');");
for (const make of [makes.fields, makes.filled, makes.table, makes.deleted, makes.made, makes.bare]) lines.push("during: " + attempt(() => during(make(2))));
console.log(lines.join("\n"));

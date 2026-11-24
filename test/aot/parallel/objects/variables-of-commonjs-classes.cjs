// A class moves to the start of its file. Its methods read variables that the file stores later: what they find depends on where the class is used.
function show(name, f) {
  let v;
  try { v = f(); } catch (e) { v = e.constructor.name; }
  console.log(name, typeof v, Array.isArray(v) ? JSON.stringify(v) : typeof v === "function" ? "function" : String(v));
}
show("hoisted function in front", () => early(1));
show("class in front", () => new Reader(1).all());
show("static in front", () => Reader.first());
show("prototype in front", () => Reader.prototype.all.call({ n: 2 }));
const alias = Reader;
show("alias in front", () => new alias(3).sum());
var limit = 6;
show("behind one", () => new Reader(1).all());
var text = "abc";
const holder = { Reader };
show("holder behind two", () => new holder.Reader(1).all());
var list = [3, 1, 2];
let late = Number(process.argv.length > 99 ? 1 : 9);
const fixed = 7;
show("behind all", () => new Reader(1).all());
show("sum behind all", () => new Reader(1).sum());
show("derived", () => new Derived(2).all());
show("made in a static", () => Reader.make(4).sum());
show("getter", () => new Reader(1).size);
show("array of a limit", () => new Reader(1).array());
show("switch", () => [0, 6, 7, "abc"].map(x => new Reader(1).choose(x)));
show("functions", () => early(2));
exports.Reader = Reader;
class Reader {
  constructor(n) { this.n = n; this.limit = limit; }
  all() { return [typeof limit, typeof text, typeof list, safe(() => late), safe(() => fixed), this.n]; }
  sum() { let s = 0; for (let i = 0; i < 100; i++) s = (s + limit + i + this.n) | 0; return s; }
  get size() { return text.length + list.length + list[0] + list[1] + list[2]; }
  array() { const a = new Array(limit); a[0] = this.n; return [a.length, 1 in a, a[0]]; }
  choose(x) { switch (x) { case limit: return "limit"; case fixed: return "fixed"; case text: return "text"; default: return "other"; } }
  static first() { return [limit, text === undefined, list === undefined]; }
  static make(n) { return new Reader(n); }
}
class Derived extends Reader { all() { return ["derived", ...super.all(), Later.value()]; } }
class Later { static value() { return after; } }
show("a class whose variable is not stored yet", () => Later.value());
var after = "after";
show("a class whose variable is stored", () => Later.value());
class Counter { static next() { return ++count; } static read() { return count; } }
var count = 40;
show("counted", () => [Counter.next(), Counter.next(), Counter.read()]);
let Chosen = class { read() { return chosen; } };
show("class of a variable", () => new Chosen().read());
var chosen = [1, 2];
Chosen = class { read() { return [...chosen, 3]; } };
show("another class of the variable", () => new Chosen().read());
for (let i = 0; i < 3; i++) show("loop " + i, () => new Reader(i).sum());
queueMicrotask(() => show("microtask", () => new Reader(5).all()));
function early(n) { return new Reader(n).all(); }
function safe(f) { try { return f(); } catch (e) { return e.constructor.name; } }

// The names that a module of a bundle declares: read before, while and behind its body runs, stored again, and laid on prototypes early and late.
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() { return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports; };
const out = [], later = [];
const say = (title, f) => { let v; try { v = f(); } catch (e) { v = "!" + e.constructor.name; } out.push(title + "=" + (typeof v === "function" ? "function" : typeof v === "object" ? JSON.stringify(v) : String(v))); };
var require_names = __commonJS({ "names.js"(exports, module) {
  say("early const", () => readsLimit());
  say("early class", () => makes());
  say("early let", () => counts());
  say("early var", () => old);
  say("early declared", () => declared(2));
  const limit = 4;
  function readsLimit() { return limit; }
  function declared(n) { return n > 0 ? declared(n - 1) + limitOrNone() : "end"; }
  function limitOrNone() { try { return limit; } catch { return "none"; } }
  class Item { static made = 0; constructor() { Item.made++; this.n = limit; } again() { return new Item(); } }
  function makes() { return new Item().again().n + Item.made; }
  let count = 0;
  function counts() { return ++count; }
  var old = "old", unset;
  function changes() { old += "er"; declared = () => "changed"; return old; }
  say("const", readsLimit); say("class", makes); say("let", counts); say("declared", () => declared(1));
  const closures = [];
  for (let i = 0; i < 3; i++) { const twice = i * 2; closures.push(() => twice + i); i += 0; }
  { const inner = "inner"; let stored = 1; closures.push(() => inner + stored++); function block() { return inner; } closures.push(() => block()); }
  switch (limit) { case 4: let chosen = "four"; closures.push(() => chosen); break; default: closures.push(() => chosen); }
  try { throw { code: 7, deep: { text: "t" } }; } catch ({ code, deep: { text } }) { closures.push(() => code + text); }
  function require(name) { return "own " + name; }
  const recursive = function self(n) { return n ? self(n - 1) + 1 : typeof self; };
  function* steps() { yield limit; yield count; }
  const later1 = async () => [limit, count, old];
  exports.all = () => [limit, count, old, unset, typeof Item, closures.map(f => f()).join(), require("./x"), recursive(2), [...steps()].join(), typeof module, module.exports === exports];
  exports.change = changes; exports.counts = counts; exports.Item = Item; exports.later = later1;
  later.push(() => exports.all().join("|"), () => changes(), () => declared(1), () => { Item = null; });
} });
var require_first = __commonJS({ "first.js"(exports, module) {
  function Shape(n) { this.n = n; }
  function area() { return this.n * 2; }
  function name() { return "shape" + this.n; }
  Shape.prototype.area = area;
  Shape.prototype.name = name;
  Shape.prototype.both = function () { return this.name() + this.area(); };
  function Early(n) { this.n = n; }
  exports.Early = Early;
  say("cycle", () => require_second().use());
  Early.prototype.area = area;
  Early.prototype.name = function () { return "early" + this.n; };
  function Once(n) { this.n = n; say("in constructor", () => this.area()); }
  say("before", () => new Once(1));
  Once.prototype.area = area;
  say("behind", () => new Once(2).area());
  function Chosen(n) { this.n = n; }
  if (out.length > 1000) Chosen.prototype.area = area;
  Chosen.prototype.name = name;
  function Replaced(n) { this.n = n; }
  Replaced.prototype.area = area;
  Replaced.prototype = { area() { return "new" + this.n; } };
  function Deleted(n) { this.n = n; }
  Deleted.prototype.area = area; Deleted.prototype.name = name;
  later.push(() => { delete Deleted.prototype.area; return "deleted"; });
  function Below(n) { Shape.call(this, n); }
  Below.prototype = Object.create(Shape.prototype);
  Below.prototype.name = function () { return "below" + this.n; };
  function sum(list) { let s = ""; for (let i = 0; i < 3; i++) for (const o of list) { try { s += o.area() + "," + o.name() + ";"; } catch (e) { s += e.constructor.name + ";"; } } return s; }
  exports.sum = () => sum([new Shape(1), new Early(2), new Once(3), new Chosen(4), new Replaced(5), new Deleted(6), new Below(7)]);
  exports.both = () => new Shape(8).both() + new Below(9).both();
  exports.Shape = Shape;
} });
var require_second = __commonJS({ "second.js"(exports, module) {
  const first = require_first();
  say("half", () => Object.keys(first).join());
  exports.use = () => { const e = new first.Early(1); return typeof e.area + typeof e.name; };
  say("second", exports.use);
} });
var require_thrown = __commonJS({ "thrown.js"(exports, module) {
  exports.Half = Half;
  exports.read = () => [typeof Half.prototype.late, typeof reads, reads()];
  function reads() { try { return never; } catch (e) { return e.constructor.name; } }
  function Half() {}
  Half.prototype.soon = reads;
  if (out.length) throw new RangeError("thrown");
  Half.prototype.late = reads;
  const never = 1;
} });
const names = require_names();
say("names", () => names.all()); say("change", () => names.change()); say("again", () => names.all()); say("item", () => new names.Item().again().n);
const first = require_first();
say("sum", first.sum); say("both", first.both);
first.Shape.prototype.area = function () { return "later" + this.n; };
say("sum later", first.sum); say("both later", first.both);
say("thrown", () => require_thrown()); say("thrown again", () => Object.keys(require_thrown()).join()); say("half", () => { const { Half, read } = require_thrown(); return [typeof new Half().soon, typeof new Half().late, read()]; });
for (const [i, f] of later.entries()) say("later " + i, f);
say("sum last", first.sum); say("names last", () => names.all());
names.later().then(v => { say("async", () => v); console.log(out.join("\n")); });

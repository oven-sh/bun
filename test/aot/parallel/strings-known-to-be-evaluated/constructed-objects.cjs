// Functions out of strings that a method makes from the fields of an object, which its constructor fills with constants.
const say = (...a) => console.log(...a.map(x => typeof x === "function" ? x.toString() : x));
const attempt = f => { try { return f(); } catch (e) { return e.name + ": " + e.message; } };
function Sieve(mesh, rows) { this.grains = 0; this.rows = rows | 0; this.mesh = mesh; this.woven(); }
Sieve.prototype.woven = function () {
  if (!(this.rows >= 1)) throw new Error("no rows to sift by");
  if (this.mesh !== 8) { this.knot(); this.sift = this.tied; return; }
  this.sift = this.through;
};
Sieve.prototype.through = function (list) { return "fell through " + list.length; };
Sieve.prototype.knot = function () {
  var lines = "let at = 0, ", row = 0;
  while (row < this.rows) { lines += "heap" + row + " = 0, "; row += 1; }
  lines += "all = list.length; while (at < all) { ";
  for (row = 0; row < this.rows; row++) lines += "heap" + row + " = this.mesh * list[at] + heap" + row + "; at = at + 1; ";
  lines += "} this.grains = all + this.grains; return String(" + (this.rows > 1 ? "heap0 + ':' + heap1" : "heap0") + ");";
  this.tied = Function("list", lines);
};
for (const [mesh, rows] of [[2, 1], [0.5, 2]]) { const sieve = new Sieve(mesh, rows); say(sieve.sift([1, 2, 3, 4, 5, 6]), sieve.sift(new Float32Array([1, 2, 3, 4])), sieve.grains, sieve.tied, sieve.tied.name, sieve.tied.length); }
const one = new Sieve(3, 1), two = new Sieve(3, 2), same = new Sieve(4, 2), three = new Sieve(3, 3), eight = new Sieve(8, 2);
say(one.sift([1, 2]), two.sift([1, 2, 3, 4]), same.sift([1, 2]), three.sift([1, 2, 3]), eight.sift([1]), one.tied === two.tied, two.tied === same.tied, attempt(() => new Sieve(1, 0)));
two.rows = 1; two.knot(); say(two.tied([5, 6])); two.rows = "2"; two.knot(); say(two.tied([5, 6])); two.rows = 1.5; two.knot(); say(attempt(() => two.tied([5, 6])));
const through = Sieve.prototype.through; Sieve.prototype.through = list => "other " + list; say(new Sieve(8, 1).sift([7])); Sieve.prototype.through = through;
const knot = Sieve.prototype.knot; Sieve.prototype.knot = function () { this.tied = Function("list", "return 'replaced ' + list;"); }; say(new Sieve(2, 2).sift([9])); Sieve.prototype.knot = knot; say(new Sieve(2, 2).sift([9, 10]));
class Adder { #k = 3; constructor(n, name = "x") { this.n = n; this.name = name; } get twice() { return this.n * 2; } make() { return new Function(this.name, "return " + this.name + " + " + this.n + ";"); } byGetter() { return new Function("a", "return a * " + this.twice + ";"); } byPrivate() { return new Function("a", "return a * " + this.#k + ";"); } each(list) { return list.map(it => new Function("a", "return [a, " + it + ", " + this.n + "].join();")); } }
for (const adder of [new Adder(1), new Adder(2, "y"), new Adder("'t'"), new Adder(process.argv.length > 90 ? 5 : 6)]) say(adder.make()(10), adder.make(), attempt(() => adder.byGetter()(3)), adder.byPrivate()(3), adder.each([7, 8]).map(f => f(0)).join("|"));
class Below extends Adder { make() { return new Function("b", "return 'below ' + b + " + this.n + ";"); } } say(new Below(4).make()(1), new Below(5).each([1])[0](2));
function Plain() { this.op = "+"; this.list = ["a", "b"]; } Plain.prototype = { constructor: Plain, code(sign) { return "return " + this.list.join(sign || this.op) + ";"; }, make() { return new Function(this.list[0], this.list[1], this.code()); } };
say(new Plain().make()(1, 2), new Plain().make()); const changed = new Plain(); changed.op = "-"; say(changed.make()(5, 2)); changed.list.push("c"); say(attempt(() => changed.make()(5, 2)));
function Other(kind) { if (kind === "object") return { kind: 1, make: Other.prototype.make }; this.kind = kind; } Other.prototype.make = function () { return Function("q", "return '" + this.kind + "' + q;"); };
say(new Other("a").make()(1), new Other("object").make()(2), new Other("b'+'c").make()(3), Other.prototype.make.call({ kind: "called" })(4), Reflect.construct(Other, ["r"]).make()(5));
function Maybe(flag, n) { this.n = n; if (flag) this.n = n + 1; else this.extra = 1; } Maybe.prototype.make = function () { return Function("z", "return z + " + this.n + ";"); }; say(new Maybe(true, 1).make()(0), new Maybe(false, 1).make()(0), new Maybe(process.argv.length < 90, 5).make()(0));
const local = (function () { function Inner(n) { this.n = n; } Inner.prototype.make = function () { return Function("v", "return typeof Inner + v + " + this.n + ";"); }; return n => n ? new Inner(1) : new Inner(2); })(); say(local(0).make()(1), local(1).make()(1));
Object.defineProperty(Sieve.prototype, "rows", { get() { return 2; }, set() {}, configurable: true }); say(new Sieve(2, 1).sift([1, 2, 3, 4])); delete Sieve.prototype.rows; say(new Sieve(2, 1).sift([1, 2, 3, 4]));
function Grows(n) { this.n = n; this.next(); } Grows.prototype.next = function () { this.tied = Function("g", "return g + " + this.n + ";"); this.n++; if (this.n < 4) this.next(); }; say(new Grows(0).tied(1), new Grows(3).tied(1), new Grows(9).tied(1));
let sum = 0; const hot = new Sieve(2, 2); const data = new Float32Array(64).fill(0.5); for (let i = 0; i < 200; i++) sum += +hot.sift(data).split(":")[1]; say(sum, hot.grains);

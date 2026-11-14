// Functions out of strings that a method makes from the fields of an object, which its constructor fills with constants.
const say = (...a) => console.log(...a.map(x => typeof x === "function" ? x.toString() : x));
const attempt = f => { try { return f(); } catch (e) { return e.name + ": " + e.message; } };
function Mixer(rate, channels) { this.rate = rate; this.channels = channels | 0; this.total = 0; this.initialize(); }
Mixer.prototype.initialize = function () {
  if (this.rate > 0 && this.channels > 0) { if (this.rate == 8) { this.mix = this.pass; } else { this.compile(); this.mix = this.made; } }
  else throw new Error("no channels");
};
Mixer.prototype.pass = function (list) { return "pass " + list.length; };
Mixer.prototype.compile = function () {
  var code = "var sums = []; ";
  for (var channel = 0; channel < this.channels; ++channel) code += "var sum" + channel + " = 0;";
  code += "for (var at = 0; at < list.length;) {";
  for (channel = 0; channel < this.channels; ++channel) code += "sum" + channel + " += list[at++] * this.rate;";
  code += "}\n this.total += list.length; return [" + (this.channels > 1 ? "sum0, sum1" : "sum0") + "].join();";
  this.made = Function("list", code);
};
for (const [rate, channels] of [[2, 1], [0.5, 2]]) { const mixer = new Mixer(rate, channels); say(mixer.mix([1, 2, 3, 4, 5, 6]), mixer.mix(new Float32Array([1, 2, 3, 4])), mixer.total, mixer.made, mixer.made.name, mixer.made.length); }
const one = new Mixer(3, 1), two = new Mixer(3, 2), same = new Mixer(4, 2), three = new Mixer(3, 3), eight = new Mixer(8, 2);
say(one.mix([1, 2]), two.mix([1, 2, 3, 4]), same.mix([1, 2]), three.mix([1, 2, 3]), eight.mix([1]), one.made === two.made, two.made === same.made, attempt(() => new Mixer(1, 0)));
two.channels = 1; two.compile(); say(two.made([5, 6])); two.channels = "2"; two.compile(); say(two.made([5, 6])); two.channels = 1.5; two.compile(); say(attempt(() => two.made([5, 6])));
const pass = Mixer.prototype.pass; Mixer.prototype.pass = list => "other " + list; say(new Mixer(8, 1).mix([7])); Mixer.prototype.pass = pass;
const compile = Mixer.prototype.compile; Mixer.prototype.compile = function () { this.made = Function("list", "return 'replaced ' + list;"); }; say(new Mixer(2, 2).mix([9])); Mixer.prototype.compile = compile; say(new Mixer(2, 2).mix([9, 10]));
class Adder { #k = 3; constructor(n, name = "x") { this.n = n; this.name = name; } get twice() { return this.n * 2; } make() { return new Function(this.name, "return " + this.name + " + " + this.n + ";"); } byGetter() { return new Function("a", "return a * " + this.twice + ";"); } byPrivate() { return new Function("a", "return a * " + this.#k + ";"); } each(list) { return list.map(it => new Function("a", "return [a, " + it + ", " + this.n + "].join();")); } }
for (const adder of [new Adder(1), new Adder(2, "y"), new Adder("'t'"), new Adder(process.argv.length > 90 ? 5 : 6)]) say(adder.make()(10), adder.make(), attempt(() => adder.byGetter()(3)), adder.byPrivate()(3), adder.each([7, 8]).map(f => f(0)).join("|"));
class Below extends Adder { make() { return new Function("b", "return 'below ' + b + " + this.n + ";"); } } say(new Below(4).make()(1), new Below(5).each([1])[0](2));
function Plain() { this.op = "+"; this.list = ["a", "b"]; } Plain.prototype = { constructor: Plain, code(sign) { return "return " + this.list.join(sign || this.op) + ";"; }, make() { return new Function(this.list[0], this.list[1], this.code()); } };
say(new Plain().make()(1, 2), new Plain().make()); const changed = new Plain(); changed.op = "-"; say(changed.make()(5, 2)); changed.list.push("c"); say(attempt(() => changed.make()(5, 2)));
function Other(kind) { if (kind === "object") return { kind: 1, make: Other.prototype.make }; this.kind = kind; } Other.prototype.make = function () { return Function("q", "return '" + this.kind + "' + q;"); };
say(new Other("a").make()(1), new Other("object").make()(2), new Other("b'+'c").make()(3), Other.prototype.make.call({ kind: "called" })(4), Reflect.construct(Other, ["r"]).make()(5));
function Maybe(flag, n) { this.n = n; if (flag) this.n = n + 1; else this.extra = 1; } Maybe.prototype.make = function () { return Function("z", "return z + " + this.n + ";"); }; say(new Maybe(true, 1).make()(0), new Maybe(false, 1).make()(0), new Maybe(process.argv.length < 90, 5).make()(0));
const local = (function () { function Inner(n) { this.n = n; } Inner.prototype.make = function () { return Function("v", "return typeof Inner + v + " + this.n + ";"); }; return n => n ? new Inner(1) : new Inner(2); })(); say(local(0).make()(1), local(1).make()(1));
Object.defineProperty(Mixer.prototype, "channels", { get() { return 2; }, set() {}, configurable: true }); say(new Mixer(2, 1).mix([1, 2, 3, 4])); delete Mixer.prototype.channels; say(new Mixer(2, 1).mix([1, 2, 3, 4]));
function Grows(n) { this.n = n; this.next(); } Grows.prototype.next = function () { this.made = Function("g", "return g + " + this.n + ";"); this.n++; if (this.n < 4) this.next(); }; say(new Grows(0).made(1), new Grows(3).made(1), new Grows(9).made(1));
let sum = 0; const hot = new Mixer(2, 2); const data = new Float32Array(64).fill(0.5); for (let i = 0; i < 200; i++) sum += +hot.mix(data).split(",")[1]; say(sum, hot.total);

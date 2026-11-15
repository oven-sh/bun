// Constructors that new names through variables, IIFEs and calls; their prototypes are literals that a parameter or a variable holds.
function attempt(f) { try { return String(f()); } catch (e) { return e.name + ": " + e.message.replace(/ \((evaluating|near).*/, ""); } }
var Point = function () { this.init.apply(this, arguments); };
Point.prototype.init = function (x, y) { this.x = x; this.y = y; };
Point.prototype.sum = function () { return this.x + this.y; };
var Pair = (function (methods) { function Pair() { this.init.apply(this, arguments); } Pair.prototype = methods; methods.constructor = Pair; return Pair; })({ init: function (p, k) { this.p = p; this.k = k; }, go: function () { return this.p.sum() + this.k; } });
var shared = { init: function (a) { this.a = a; }, show: function () { return this.a + (this.b === undefined ? "" : "," + this.b); } };
var One = function (a) { this.init(a); }; One.prototype = shared;
var Two = function (a, b) { this.b = b; this.init(a); }; Two.prototype = shared;
var Class = { create: function (methods) { function Made() { this.init.apply(this, arguments); } Made.prototype = methods; return Made; } };
var Left = Class.create({ init: function (v) { this.v = v; }, value: function () { return this.v; } });
var Right = Class.create({ init: function (v, w) { this.w = w; this.v = v; }, value: function () { return this.v * this.w; } });
function run(n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = (s + new Pair(new Point(i, 1), i & 7).go() + new Left(i).value() + new Right(i, 2).value()) | 0;
  return s + new One(1).show() + new Two(2, 3).show();
}
console.log(run(50), Object.keys(new Two(1, 2)).join(), Object.keys(new Right(1, 2)).join());
console.log(new Pair(new Point(1, 2), 3) instanceof Pair, new Pair(new Point(1, 2), 3).constructor === Pair, new Left(1).constructor === Object, new One(1) instanceof Two);
// The methods run on other objects, and their holders change.
console.log(attempt(() => { const o = { sum: Point.prototype.sum, x: 4, y: 5 }; return o.sum(); }), attempt(() => shared.init.call({ a: 0 }, 7)), attempt(() => { const o = {}; shared.init.call(o, 8); return Object.keys(o) + o.a; }));
Object.defineProperty(shared, "a", { set(v) { this.seen = v; }, get() { return "got" + this.seen; }, configurable: true });
console.log(run(3), Object.keys(new One(9)).join());
delete shared.a;
shared.init = function (a) { this.other = a; };
console.log(attempt(() => new One(1).show()), attempt(() => new Two(1, 2).show()));
Point.prototype = { init: function () { this.z = 1; }, sum: function () { return 100; } };
console.log(run(3), attempt(() => new Point(1, 2).sum()), Object.keys(new Point(1, 2)).join());
Point = function () { return { sum: () => 1000 }; };
console.log(run(3));
Left.prototype.init = null;
console.log(attempt(() => run(3)), attempt(() => new Left(1).value()));
console.log(attempt(() => Pair(1, 2)), attempt(() => new (Class.create())()), attempt(() => new (Class.create({ init() { return 5; } }))().constructor.name));

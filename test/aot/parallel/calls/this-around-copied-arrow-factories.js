// An arrow takes this, new.target and arguments from where it is written, also in the base and in the computed keys of a class in it.
const say = (...all) => console.log(...all);
const attempt = run => { try { return run(); } catch (error) { return error.name; } };
const up = C => Object.getPrototypeOf(C).name, keys = C => Object.getOwnPropertyNames(C.prototype).join();
const kit = {};
(function () {
  kit.base = F => class extends (this.Parent ?? F) {};
  kit.inner = F => class extends (class extends (this.Parent ?? F) {}) { in() { return up(Object.getPrototypeOf(this.constructor)); } };
  kit.method = F => class extends F { [this.key]() { return 1; } };
  kit.field = F => class extends F { [this.key] = 1; };
  kit.statics = F => class extends F { static [this.key] = 1; static get [this.key + "2"]() { return this.name; } };
  kit.getter = F => class extends F { get [this.key]() { return 2; } set [this.key](to) {} };
  kit.arrow = F => class extends F { [(() => this.key)()]() {} };
  kit.literal = F => class extends F { [Object.keys({ [this.key]() {} })[0]]() {} };
  kit.called = F => class extends (arguments[0] ?? F) {};
  kit.counted = F => class extends F { [arguments.length + "!"]() {} };
}).call({ Parent: Set, key: "named" }, Map);
const base = [kit.base(Object), kit.base(Array)], inner = [kit.inner(Object), kit.inner(Array)];
const method = [kit.method(Object), kit.method(Array)], field = [kit.field(Object), kit.field(Array)], statics = [kit.statics(Object), kit.statics(Array)], getter = [kit.getter(Object), kit.getter(Array)];
const arrow = [kit.arrow(Object), kit.arrow(Array)], literal = [kit.literal(Object), kit.literal(Array)], called = [kit.called(Object), kit.called(Array)], counted = [kit.counted(Object), kit.counted(Array)];
say(...base.map(up), ...inner.map(C => new C().in()), ...called.map(up));
say(...method.map(keys), ...field.map(C => Object.keys(new C()).join()), ...statics.map(C => Object.getOwnPropertyNames(C).slice(-2).join()), ...getter.map(keys), ...arrow.map(keys), ...literal.map(keys), ...counted.map(keys));
let mixin;
class Plugin { Base = Map; install() { mixin = Other => class extends (this.Base ?? Other) {}; } }
new Plugin().install();
class A extends mixin(Object) {}
class B extends mixin(Array) {}
say(new A() instanceof Map, new B() instanceof Map, new B() instanceof Array);
let targeted;
function Maker() { targeted = F => class extends (new.target?.Parent ?? F) { [new.target ? "yes" : "no"]() {} }; }
Maker.Parent = Set; new Maker();
const T = targeted(Object), U = targeted(Array);
say(up(T), up(U), keys(T), keys(U));
const own = F => class extends F { x = this; y = () => this; static n = this.name; static { this.z = this.n + "!"; } m(a = this) { return a === this; } k = "key"; o = { [this.k]() {} }; t() { return class extends this.constructor {}; } a() { return arguments.length; } toString() { return "own " + super.toString().length; } };
class X extends own(Object) {}
class Y extends own(Set) {}
for (const K of [X, Y]) { const it = new K(); say(it.x === it, it.y() === it, K.z, it.m(), Object.keys(it.o).join(), Object.getPrototypeOf(it.t()) === K, it.a(1, 2), String(it)); }
kit.receiver = function (F) { return class extends (this.Parent ?? F) { [this.key ?? "none"]() {} }; };
kit.Parent = Set; const P = kit.receiver(Object); kit.Parent = undefined; kit.key = "kit"; const Q = kit.receiver(Array);
say(up(P), up(Q), keys(P), keys(Q), attempt(() => new P().none()), attempt(() => new Q().kit()));
let counts;
(function () { counts = step => function Made() { this.step = step; this.given = arguments.length; this.list = [...outer(arguments)]; }; function outer(all) { return all; } })(1, 2, 3);
const M = counts(1), N = counts(2);
say(JSON.stringify(new M(5, 6)), JSON.stringify(new N(7)), new M() instanceof N);
let around;
(function () { around = step => { const kept = arguments.length; return function () { this.all = kept + step; }; }; })(1, 2, 3);
const R = around(10), S = around(20);
say(new R().all, new S().all);

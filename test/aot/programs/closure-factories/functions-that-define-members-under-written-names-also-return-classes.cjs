// Methods of helper objects and plain functions define a member under a name that the call writes out, and return a class expression with a static block.
function show(label, f) { let shown; try { shown = JSON.stringify(f()); } catch (error) { shown = error.constructor.name; } console.log(label + ": " + shown); }
function Helper1(target) { this.target = target; }
Helper1.prototype.define = function (name) { var target = this.target; target[name] = function () { return name; }; return class { static #s = 3; static { this.t = this.#s; } get() { return name; } }; };
const t1 = {};
const C1 = new Helper1(t1).define("a");
show("a method of a helper object", () => [t1.a(), C1.t, new C1().get()]);
function Helper2(target) { this.target = target; }
Helper2.prototype.define = function (name) { var target = this.target; target[name] = function () { return name; }; return class { static #s = 3; static { this.t = this.#s; } get() { return name; } }; };
const t2 = {};
class D2 extends new Helper2(t2).define("a") {}
show("a method of a helper object, extended", () => [t2.a(), D2.t, new D2().get()]);
function Helper3(target) { this.target = target; }
Helper3.prototype.define = function (name) { var target = this.target; target[name] = function () { return name; }; return class { static #s = 3; static { this.t = this.#s; } get() { return name; } }; };
const t3 = {}, u3 = {};
const h3 = new Helper3(t3); h3.target = u3;
const C3 = h3.define("a");
show("the field of the helper object is replaced", () => [typeof t3.a, u3.a(), C3.t, new C3().get()]);
function Helper4(target) { this.target = target; }
Helper4.prototype.define = function (name) { var target = this.target; let n = 1; target[name] = function () { return n; }; return class { static { n = 2; } get() { return n; } }; };
const t4 = {};
const C4 = new Helper4(t4).define("a");
show("the member and the class share a variable", () => [t4.a(), new C4().get()]);
const define5 = (target, name) => { target[name] = function () { return name; }; return class { static #s = name; static { this.t = this.#s; } }; };
const t5 = {};
const A5 = define5(t5, "a"), B5 = define5(t5, "b");
show("a function that is handed the name", () => [t5.a(), t5.b(), A5.t, B5.t]);
const t6 = {};
for (const name of ["a", "b"]) { t6[name] = function () { return name; }; t6[name + "K"] = class { static #s = name; static { this.t = this.#s; } }; }
show("a loop over written names", () => [t6.a(), t6.b(), t6.aK.t, t6.bK.t]);
const t7 = {};
["a", "b"].forEach(name => { t7[name] = function () { return name; }; t7[name + "K"] = class { static #s = name; static { this.t = this.#s; } }; });
show("a callback over written names", () => [t7.a(), t7.b(), t7.aK.t, t7.bK.t]);
const make8 = options => { const members = { get() { return options.v; } }; const K = class { static #s = options.v; static { this.t = this.#s; } }; return function (value) { const self = Object.create(members); self.value = value; self.K = K; return self; }; };
const f8 = make8({ v: 1 }), g8 = make8({ v: 2 });
show("a function that makes what Object.create is handed", () => [f8(1).get(), g8(2).get(), f8(1).K.t, g8(1).K.t]);
const make9 = v => () => class { static #s = v; static { this.t = this.#s; } };
const a9 = make9(1), b9 = make9(2);
show("a closure that returns the class", () => [a9().t, b9().t, a9() === a9()]);
function setup10() { const make = v => { let n = v; return class { static { n++; } get() { return n; } }; }; const A = make(1); class B extends make(5) {} return [new A().get(), new B().get()]; }
show("in a function that is called once", setup10);
const r11 = (function () { const make = v => { let n = v; return class { static #q = 2; static { n += this.#q; } get() { return n; } }; }; class B extends make(5) {} return new B().get(); })();
show("in a function that is called where it is written", () => r11);
const make12 = v => { let n = v; return class { static #q = 2; static { n += this.#q; } get() { return n; } }; };
module.exports = class B12 extends make12(5) {};
show("the class below is exported", () => new module.exports().get());

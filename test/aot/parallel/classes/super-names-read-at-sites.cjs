// super.name at one site: values, absent names, accessors that ask the receiver, proxies, values that come and go, primitives above.
"use strict";
const out = [];
const run = (work) => { try { const value = work(); return typeof value === "function" ? "function" : typeof value + ":" + String(value); } catch (error) { return error.constructor.name; } };
const make = (Parent) => class extends Parent { read() { return super.value; } call(...args) { return super.value(...args); } name() { return super.length; } store(v) { super.value = v; } loop(n) { let last; for (let k = 0; k < n; k++) last = super.value; return last; } symbol() { return super[Symbol.iterator]; } index() { return super[0]; } };
function Base() { this.own = 1; }
const parents = [() => { function P() {} P.prototype.value = 5; return P; }, () => { function P() {} P.prototype.value = function () { return "called " + (this && this.own); }; return P; }, () => class { get value() { return "got " + this.own + (this instanceof Object); } set value(v) { this.stored = v; } constructor() { this.own = 7; } }, () => class { value(...a) { return a.length + "method" + this.own; } constructor() { this.own = 8; } }, () => Base, () => class extends Base { }, () => { function P() {} P.prototype = new Proxy({ value: 1 }, { get(target, name, receiver) { out.push("trap " + String(name) + (receiver === target)); return target[name]; } }); return P; }, () => { function P() {} P.prototype = Object.create(null, { value: { value: "fixed" }, length: { value: 3 } }); return P; }, () => Array, () => class extends Map { get value() { return this.size; } }, () => { class P { static x = 1; } P.prototype.value = null; P.prototype[0] = "zero"; return P; }, () => { function P() {} for (let k = 0; k < 80; k++) P.prototype["name" + k] = k; P.prototype.value = "late"; delete P.prototype.name3; return P; }];
for (let round = 0; round < 3; round++) for (let k = 0; k < parents.length; k++) {
  const Parent = parents[k](), Class = make(Parent), object = new Class();
  const all = () => [run(() => object.read()), run(() => object.call(1, 2)), run(() => object.name()), run(() => object.loop(30)), run(() => object.symbol() !== undefined), run(() => object.index()), run(() => { object.store(k); return Object.keys(object).join() + object.stored; })].join("|");
  out.push(k + all(), all());
  const above = Object.getPrototypeOf(Class.prototype);
  for (const change of [() => { above.value = "changed"; }, () => { delete above.value; }, () => { Object.defineProperty(above, "value", { get() { return "asked " + (this === object); }, configurable: true }); }, () => { Object.defineProperty(above, "value", { value: 11, configurable: true }); }, () => { Object.setPrototypeOf(Class.prototype, { value: () => "moved" }); }, () => { Object.setPrototypeOf(Class.prototype, null); }, () => { Object.setPrototypeOf(Class.prototype, parents[(k + 1) % 5]().prototype); }]) if (Parent !== Array) out.push(run(change), all());
}
// One site, many classes: the site learns several structures, some of them without the name.
const classes = []; for (let k = 0; k < 12; k++) { function P() {} if (k % 3) P.prototype["only" + k] = k; if (k % 4) P.prototype.value = "v" + k; classes.push(make(P)); }
for (let round = 0; round < 40; round++) { const Class = classes[round % classes.length], object = new Class(); const answer = run(() => object.read()) + "," + run(() => object.loop(3)); if (round > 24) out.push(answer); }
const literal = { __proto__: { value: "literal", hello() { return "hello " + this.n; } }, n: 1, read() { return super.value; }, hello() { return super.hello() + super.nothing; } };
for (let k = 0; k < 10; k++) out.push(literal.read() + literal.hello());
Object.setPrototypeOf(literal, { value: 2 }); out.push(run(() => literal.read()), run(() => literal.hello()));
Object.setPrototypeOf(literal, null); out.push(run(() => literal.read()), run(() => literal.hello()));
for (const line of out) console.log(line.slice(0, 300));

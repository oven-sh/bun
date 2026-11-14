// super in methods of classes that a function makes again and again: the base is read off the object of the class.
"use strict";
const out = [];
const run = (work) => { try { return String(work()); } catch (error) { return error.constructor.name + " " + error.message.slice(0, 60); } };
class Base { constructor(n) { this.n = n; } name() { return "Base" + this.n; } get kind() { return "kind" + this.n; } set kind(v) { this.set = v; } async later() { return this.name(); } *each() { yield this.n; yield this.name(); } ["com" + "puted"](x) { return x + this.n; } }
function Plain(n) { this.n = n; }
Plain.prototype = { name() { return "Plain" + this.n; }, get kind() { return "plain" + this.n; }, later() { return Promise.resolve("p" + this.n); }, *each() { yield "e" + this.n; }, computed(x) { return "c" + x; } };
const key = Symbol("key");
Base.prototype[key] = function () { return "key" + this.n; };
const forms = [
  (Parent) => class extends Parent { name() { return "A" + super.name(); } get kind() { return super.kind + "!"; } set kind(v) { super.kind = v; } later() { return super.later(); } *each() { yield* super.each(); } computed(x) { return super.computed(x) + super["comp" + "uted"](x); } [key]() { return super[key] && super[key](); } nested() { return [1, 2].map((x) => super.name() + x).join(); } eval() { return eval("super.name()"); } missing() { return typeof super.missing; } called() { return super.nothing(); } store() { super.stored = 5; return this.stored; } remove() { return delete super.name; } },
  (Parent) => class Named extends Parent { static n = 7; static name2() { return super.name2 ? super.name2() : "top"; } static #hidden = 3; static read() { return Named.#hidden + this.n; } static { this.made = typeof super.length; } name() { return "B" + super.name() + Named.n; } get kind() { return super.kind; } later() { return super.later(); } *each() { yield super.name(); } computed(x) { return super.computed(x); } nested() { return (() => () => super.name())()(); } },
  (Parent) => class extends Parent { static length() { return 1; } static name() { return "static"; } static prototype2 = 1; field = super.name(); arrow = () => super.kind; name() { return super.name() + this.field; } get kind() { return super.kind; } later() { return super.later(); } *each() { yield this.arrow(); } computed(x) { return super.computed(x); } },
  (Parent) => { class Local extends Parent { name() { return "L" + super.name(); } later() { return super.later(); } *each() { yield super.computed(1); } computed(x) { return super.computed(x); } } for (let k = 0; k < 70; k++) Local["static" + k] = k; for (let k = 0; k < 60; k++) delete Local["static" + k]; Local.more = 1; return Local; },
  (Parent) => Object.freeze(class extends Parent { name() { return "F" + super.name(); } later() { return super.later(); } *each() { yield super.name(); } computed(x) { return super.computed(x); } }),
  (Parent) => { class Own extends Parent { static get ["pro" + "to"]() { return 1; } name() { return "O" + super.name(); } later() { return super.later(); } *each() { yield super.name(); } computed(x) { return super.computed(x); } } Object.defineProperty(Own, "name", { value: "given", configurable: true }); Object.setPrototypeOf(Own, Function.prototype); return Own; },
  (Parent) => new Proxy(class extends Parent { name() { return "P" + super.name(); } later() { return super.later(); } *each() { yield super.name(); } computed(x) { return super.computed(x); } }, {}),
];
const loops = (object, times) => { let text = ""; for (let k = 0; k < times; k++) text = object.name() + run(() => object.kind) + object.computed(k); return text; };
const everything = (Class, n) => { const object = new Class(n); const lines = [loops(object, 20), run(() => [...object.each()].join()), run(() => object.nested && object.nested()), run(() => object.eval && object.eval()), run(() => object[key] && object[key]()), run(() => object.missing && object.missing()), run(() => object.called && object.called()), run(() => object.store && object.store()), run(() => object.remove && object.remove()), run(() => { object.kind = 9; return object.set; }), run(() => Class.read && Class.read()), run(() => Class.name2 && Class.name2()), run(() => Class.made)]; object.later().then((v) => console.log("later " + v)); return lines.join("|"); };
for (let round = 0; round < 3; round++) for (const form of forms) for (const Parent of [Base, Plain]) {
  out.push(run(() => everything(form(Parent), round)));
  out.push(run(() => everything(form(form(Parent)), round)));
  out.push(run(() => everything(forms[(round + 1) % 3](form(Parent)), round)));
}
// What stands above the prototype changes: another object, null, a proxy, an object with accessors.
for (const form of forms.slice(0, 5)) for (const above of [() => ({ name() { return "other"; }, get kind() { return "ok"; }, later() { return Promise.resolve(1); }, *each() { yield 1; }, computed(x) { return -x; } }), () => null, () => new Proxy(Base.prototype, { get(target, name, receiver) { out.push("trap " + String(name)); return Reflect.get(target, name, receiver); } }), () => Object.create(Base.prototype, { name: { get() { return () => "got" + this.n; } } }), () => Plain.prototype]) {
  const Class = form(Base), object = new Class(4);
  out.push(loops(object, 3));
  out.push(run(() => Object.setPrototypeOf(Class.prototype, above())) ? "set" : "", run(() => loops(object, 3)), run(() => [...object.each()].join()));
  out.push(run(() => { Class.prototype = {}; return "stored"; }), run(() => { Object.defineProperty(Class, "prototype", { value: {} }); return "defined"; }), run(() => delete Class.prototype), run(() => loops(object, 2)));
}
for (const heritage of [null, Array, Map, Error, Promise, Uint8Array, Proxy, 5, undefined, {}, () => 1, function* () {}]) out.push(run(() => { const make = (H) => class extends H { text() { return super.toString === undefined ? "none" : typeof super.toString(); } }; const Class = make(heritage); const made = heritage === null ? Object.create(Class.prototype) : heritage === Promise ? new Class(() => {}) : new Class(); return made.text() + Object.keys(made) + made.text(); }));
const moved = new (forms[0](Base))(8);
out.push(run(() => moved.name.call({ n: 1 })), run(() => moved.name.call(undefined)), run(() => moved.nested.call({ n: 2 })), run(() => Object.create(moved).name()));
for (const line of out) console.log(line.slice(0, 400));

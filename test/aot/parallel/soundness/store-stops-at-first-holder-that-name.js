// A store looks up the chain for the name and stops at the first holder that has it. A method there is a writable data property: the store creates a property of the object,
// whatever lies above: a setter, a getter alone, a property that cannot be written.
"use strict";
const log = [];
function attempt(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
function show(o, key) { return `${typeof o[key]}:${Object.hasOwn(o, key)}`; }

class WithSetter { set x(v) { log.push("setter " + (typeof v === "function" ? "a function" : v)); } get x() { return "got"; } }
class HidesSetter extends WithSetter { x() { return "method"; } }
class BelowHidden extends HidesSetter {}
class WithGetterAlone { get x() { return "only got"; } }
class HidesGetter extends WithGetterAlone { x() {} }
class WithReadOnly {}
Object.defineProperty(WithReadOnly.prototype, "x", { value: "fixed", writable: false, configurable: true });
class HidesReadOnly extends WithReadOnly { x() {} }
function store(o, v) { o.x = v; return show(o, "x"); }

for (const Kind of [WithSetter, HidesSetter, BelowHidden, WithGetterAlone, HidesGetter, WithReadOnly, HidesReadOnly]) {
  const answers = [];
  for (let i = 0; i < 3; i++) answers.push(attempt(() => store(new Kind(), i)));
  console.log(Kind.name, answers.join(" "), log.splice(0).join());
}

// Each store written where the class is known.
console.log(attempt(() => { const o = new HidesSetter(); o.x = 1; return show(o, "x"); }), attempt(() => { const o = new BelowHidden(); o.x = 2; return show(o, "x"); }),
  attempt(() => { const o = new HidesGetter(); o.x = 3; return show(o, "x"); }), attempt(() => { const o = new HidesReadOnly(); o.x = 4; return show(o, "x"); }), log.splice(0).join());

// In a constructor, on `this`.
class StoresInConstructor extends HidesSetter { constructor() { super(); this.x = 5; } }
console.log(show(new StoresInConstructor(), "x"), log.splice(0).join());

// The static side.
class StaticSetter { static set y(v) { log.push("static setter " + v); } }
class StaticHides extends StaticSetter { static y() {} }
class StaticBelow extends StaticHides {}
StaticHides.y = 1; StaticBelow.y = 2; StaticSetter.y = 3;
console.log(show(StaticHides, "y"), show(StaticBelow, "y"), show(StaticSetter, "y"), log.splice(0).join());

// Compound stores read the method and store what comes of it.
{ const o = new HidesSetter(); o.x += "!"; console.log(typeof o.x, o.x.startsWith("x()"), Object.hasOwn(o, "x"), log.splice(0).join()); }
{ const o = new HidesSetter(); o.x ??= 1; o.x &&= 2; console.log(o.x, Object.hasOwn(o, "x"), log.splice(0).join()); }

// The member that hides goes away, or becomes something else: then what is there decides.
class Changing extends WithSetter { x() {} }
console.log(store(new Changing(), 1), log.splice(0).join());
delete Changing.prototype.x;
console.log(store(new Changing(), 2), log.splice(0).join());
Changing.prototype.x = function () {};
console.log(attempt(() => show(Changing.prototype, "x")), store(new Changing(), 3), log.splice(0).join());
Object.defineProperty(Changing.prototype, "x", { value() {}, writable: true, configurable: true });
console.log(store(new Changing(), 4), log.splice(0).join());
Object.defineProperty(Changing.prototype, "x", { set(v) { log.push("nearer setter " + v); }, configurable: true });
console.log(store(new Changing(), 5), log.splice(0).join());
Object.defineProperty(Changing.prototype, "x", { value: 1, writable: false, configurable: true });
console.log(attempt(() => store(new Changing(), 6)), log.splice(0).join());

// Constructor functions.
function Above() {}
Object.defineProperty(Above.prototype, "x", { set(v) { log.push("function setter " + v); }, configurable: true });
function Hiding() {}
Hiding.prototype = Object.create(Above.prototype);
Object.defineProperty(Hiding.prototype, "x", { value() {}, writable: true, configurable: true, enumerable: false });
console.log(store(new Hiding(), 7), store(new Above(), 8), log.splice(0).join());

// A name of Object.prototype below a class that defines it.
class Named { toString() { return "named"; } }
{ const o = new Named(); o.toString = () => "own"; console.log(String(o), Object.hasOwn(o, "toString"), String(new Named())); }

// An object that cannot take the property.
console.log(attempt(() => store(Object.preventExtensions(new HidesSetter()), 9)), attempt(() => store(Object.freeze(new HidesSetter()), 10)), log.splice(0).join());

// Reflect.set with another receiver, and super.x = in a method.
{ const receiver = {}; console.log(Reflect.set(new HidesSetter(), "x", 11, receiver), Object.hasOwn(receiver, "x"), log.splice(0).join()); }
class StoresThroughSuper extends HidesSetter { put(v) { super.x = v; return show(this, "x"); } }
class StoresThroughSuperToSetter extends WithSetter { put(v) { super.x = v; return show(this, "x"); } }
console.log(new StoresThroughSuper().put(12), new StoresThroughSuperToSetter().put(13), log.splice(0).join());

// What is handed is a class in a `let`, a class that is replaced later, a bound class, a proxy, a function, null.
const lines = [];
const Mixin = (Parent) => class extends Parent { extra = 1; #hidden = 2; read() { return this.#hidden + this.extra; } };
let Changing = class { label() { return "first"; } };
class A extends Mixin(Changing) {}
Changing = class { label() { return "second"; } };
class B extends Mixin(Changing) {}
class Plain { label() { return "plain"; } }
const Wrapped = new Proxy(Plain, { construct(target, list, newTarget) { lines.push("trap"); return Reflect.construct(target, list, newTarget); } });
class C extends Mixin(Wrapped) {}
function Old() { this.old = 3; } Old.prototype.label = function () { return "old" + this.old; };
class D extends Mixin(Old) {}
const Bound = Plain.bind(null);
let threw; try { class E extends Mixin(Bound) {} new E(); threw = "no"; } catch (error) { threw = error.constructor.name; }
const Nothing = Mixin(null);
let nothing; try { new Nothing(); nothing = "made"; } catch (error) { nothing = error.constructor.name; }
for (const K of [A, B, C, D]) { const made = new K(); lines.push(made.label(), made.read()); }
lines.push(threw, nothing, Object.getPrototypeOf(Nothing.prototype) === null, Object.getPrototypeOf(Nothing) === Function.prototype);
for (const bad of [undefined, 1, "text", {}, () => 1]) { try { Mixin(bad); lines.push("made"); } catch (error) { lines.push(error.constructor.name); } }
console.log(lines.join(" "));

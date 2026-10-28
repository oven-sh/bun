// The prototype of the class out of the function, of its `prototype`, of the class below and of the class above are changed after the classes are declared.
const lines = [];
class Base { id = 1; name() { return "base"; } static make() { return "base-static"; } }
class Swap { id = 2; name() { return "swap"; } static make() { return "swap-static"; } }
const Mixin = (Parent) => class extends Parent { more = 3; name() { return "mixin>" + super.name(); } static make() { return "mixin>" + super.make(); } };
class A extends Mixin(Base) { name() { return "a>" + super.name(); } }
class B extends Mixin(Base) {}
function show(K) { const made = new K(); return [made.name(), K.make(), made.id, made.more, made instanceof Base, made instanceof Swap].join(","); }
lines.push(show(A), show(B));
const MixedA = Object.getPrototypeOf(A);
Object.setPrototypeOf(MixedA, Swap);
lines.push(show(A), show(B));
Object.setPrototypeOf(MixedA.prototype, Swap.prototype);
lines.push(show(A), show(B));
Object.setPrototypeOf(B, Swap);
lines.push(show(A), show(B));
Object.setPrototypeOf(B.prototype, Swap.prototype);
lines.push(show(A), show(B));
Base.prototype.name = function () { return "patched"; };
class C extends Mixin(Base) {}
lines.push(show(C));
console.log(lines.join(" | "));

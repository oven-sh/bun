// The function that returns the class calls itself, is called from a static block of the class it makes, from a getter of what it is handed, and from a generator.
const lines = [];
class Base { static depth = 0; v = 1; }
const Nest = (Parent, depth = 0) => { const Inner = depth < 2 ? Nest(Parent, depth + 1) : Parent; return class extends Inner { #level = depth; level() { return this.#level; } up() { return super.level ? super.level() : -1; } static has(value) { return #level in value; } }; };
class A extends Nest(Base) {}
const a = new A();
lines.push(a.level(), a.up(), A.has(a), a.v);
let made = [];
const Reentrant = (Parent) => class extends Parent { static { if (made.length < 2) { made.push(this); made.push(Reentrant(Base)); } } #own = made.length; own() { return this.#own; } };
class B extends Reentrant(Base) {}
lines.push(made.length, new B().own(), new made[1]().own(), made[0] === Object.getPrototypeOf(B), made[1] === made[0]);
try { lines.push(B.prototype.own.call(new made[1]())); } catch (error) { lines.push(error.constructor.name); }
function* each() { for (const P of [Base, A, B]) yield class extends Nest(P, 2) {}; }
for (const K of each()) { const k = new K(); lines.push(k.level(), k.up(), k instanceof A, k instanceof B); }
console.log(lines.join(" "));

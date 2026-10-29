// A private name of a class below a mixin, stamped onto an instance of another mixin's class.
class Base {}
const mix = Parent => class extends Parent {};
const Plain = mix(Base);
const give = function (given) { return given; };
class Stamp extends give { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
const a = new Plain(), b = new Plain();
new Stamp(a);
console.log(Stamp.has(a), Stamp.has(b), Stamp.read(a));
try { Stamp.read(b); } catch (error) { console.log(error.name); }

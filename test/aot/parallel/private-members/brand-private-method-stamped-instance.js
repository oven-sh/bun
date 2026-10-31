// A private method's brand, stamped the same way.
class Base {}
const mix = Parent => class extends Parent {};
const Plain = mix(Base);
class Stamp extends function (given) { return given; } { #hidden() { return 7; } static has(given) { return #hidden in given; } static call(given) { return given.#hidden(); } }
const o = new Plain();
new Stamp(o);
console.log(Stamp.has(o), Stamp.call(o), Stamp.has(new Plain()));

// A class below a function that returns its argument puts its private names onto that argument, whatever it is. `#secret in object` says so afterwards.
class Base {}
const mix = Parent => class extends Parent {};
const Mixed = mix(Base);
class Stamp extends function (given) { return given; } {
  #secret = 1;
  static has(given) { return #secret in given; }
  static read(given) { return given.#secret; }
}

const ofMixedClass = new Mixed();
new Stamp(ofMixedClass);
console.log(Stamp.has(ofMixedClass), Stamp.has({}));
try { console.log(Stamp.read(ofMixedClass)); } catch (error) { console.log(error.name); }

const literal = {};
new Stamp(literal);
console.log(Stamp.has(literal));

class Plain { a = 1; }
const ofPlainClass = new Plain();
new Stamp(ofPlainClass);
console.log(Stamp.has(ofPlainClass), ofPlainClass.a);

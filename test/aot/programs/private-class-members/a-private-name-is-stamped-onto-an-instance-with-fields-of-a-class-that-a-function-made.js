// A class below a function that returns its argument stamps its private name onto an instance that has fields of its own, from a base class and from the class that a function made below it.
class Base { a = 1; }
const mix = Parent => class extends Parent { b = 2; };
const A = mix(Base);
class Stamp extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } }
const o = new A(); new Stamp(o); console.log(Stamp.has(o), o.a, o.b);

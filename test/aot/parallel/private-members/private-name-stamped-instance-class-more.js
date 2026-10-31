// The stamped object is frozen first: the definition throws, as in plain Bun.
class Base {}
const mix = Parent => class extends Parent {};
const Plain = mix(Base);
class Stamp extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } }
const o = Object.preventExtensions(new Plain());
try { new Stamp(o); console.log("stamped"); } catch (error) { console.log(error.name); }
console.log(Stamp.has(o));

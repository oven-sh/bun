// Alone: the fact under test is about the whole program: beside a program that lets `base` out by another road it is never made.
// An instance that is the prototype object of a constructor function is reached by a built-in the build can't name, and changed.
class B { constructor() { this.v = 1; this.w = 2; } who() { return "who"; } }
const base = new B();
function D() { this.a = 1; }
D.prototype = base;
const read = () => base.v + " " + base.w + " " + base.who() + " " + Object.keys(base).join();
console.log(read());
const above = JSON.parse("0", () => Object.getPrototypeOf)(new D());
above.fresh = "added";
console.log(above === base, read(), base.z, base.fresh);

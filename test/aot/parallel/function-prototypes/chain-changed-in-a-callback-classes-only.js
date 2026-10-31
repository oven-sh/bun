// Classes alone: the link of a base's prototype object changes before the class below it is defined.
// The change and every question stand in callbacks, and the object also goes to a function that nobody knows: prototype-linked-anew-before-anything-asked-for-its-link.js says why.
function told(ask) { try { return String(ask()); } catch (error) { return "threw " + error.name; } }
class A { who() { return "A"; } }
class Z { who() { return "Z"; } }
class B extends A {}
told(() => { Object.setPrototypeOf(B.prototype, Z.prototype); });
class C extends B {}
const c = new C();
console.log(told(() => c.who()), told(() => c instanceof A), told(() => c instanceof Z), told(() => nobodyKnows(c)));

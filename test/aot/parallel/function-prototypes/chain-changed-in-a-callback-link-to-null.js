// The topmost link of a chain of constructor functions is cut: Object.prototype is no longer above the instance.
// The change and every question stand in callbacks, and the object also goes to a function that nobody knows: prototype-linked-anew-before-anything-asked-for-its-link.js says why.
function told(ask) { try { return String(ask()); } catch (error) { return "threw " + error.name; } }
function E13() {} function M13() {}
Object.setPrototypeOf(M13.prototype, E13.prototype);
class L13 extends M13 {}
const l13 = new L13();
told(() => { Object.setPrototypeOf(E13.prototype, null); });
console.log(told(() => l13 instanceof Object), told(() => typeof l13.toString), told(() => l13 instanceof E13), told(() => nobodyKnows(l13)));

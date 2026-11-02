// A link changes and changes back: whoever asks in between and afterwards finds the chain of that moment.
// The change and every question stand in callbacks, and the object also goes to a function that nobody knows: prototype-linked-anew-before-anything-asked-for-its-link.js says why.
function told(ask) { try { return String(ask()); } catch (error) { return "threw " + error.name; } }
function E7() {} function M7() {}
Object.setPrototypeOf(M7.prototype, E7.prototype);
class L7 extends M7 {}
class B7 {}
const was = Object.getPrototypeOf(E7.prototype);
told(() => { Object.setPrototypeOf(E7.prototype, B7.prototype); });
const during = told(() => new L7() instanceof B7);
told(() => { Object.setPrototypeOf(E7.prototype, was); });
const l7 = new L7();
console.log(during, told(() => l7 instanceof B7), told(() => l7 instanceof E7), told(() => nobodyKnows(l7)));

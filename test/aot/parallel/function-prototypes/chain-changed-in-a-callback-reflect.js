// The links are set and changed by Reflect.setPrototypeOf.
// The change and every question stand in callbacks, and the object also goes to a function that nobody knows: prototype-linked-anew-before-anything-asked-for-its-link.js says why.
function told(ask) { try { return String(ask()); } catch (error) { return "threw " + error.name; } }
function E15() {} function M15() {}
Reflect.setPrototypeOf(M15.prototype, E15.prototype);
class L15 extends M15 {}
const l15 = new L15();
class B15 { hello() { return "b"; } }
told(() => { Reflect.setPrototypeOf(E15.prototype, B15.prototype); });
console.log(told(() => l15 instanceof B15), told(() => l15.hello()), told(() => B15.prototype.isPrototypeOf(l15)), told(() => nobodyKnows(l15)));

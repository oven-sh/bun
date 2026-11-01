// The links are set and changed by assignments to __proto__.
// The change and every question stand in callbacks, and the object also goes to a function that nobody knows: prototype-linked-anew-before-anything-asked-for-its-link.js says why.
function told(ask) { try { return String(ask()); } catch (error) { return "threw " + error.name; } }
function E14() {} function M14() {}
M14.prototype.__proto__ = E14.prototype;
class L14 extends M14 {}
const l14 = new L14();
class B14 { hello() { return "b"; } }
told(() => { E14.prototype.__proto__ = B14.prototype; });
console.log(told(() => l14 instanceof B14), told(() => l14.hello()), told(() => nobodyKnows(l14)));

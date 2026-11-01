// A member is added to the prototype object of a constructor function that nothing constructs, above an object that is there already.
// The change and every question stand in callbacks, and the object also goes to a function that nobody knows: prototype-linked-anew-before-anything-asked-for-its-link.js says why.
function told(ask) { try { return String(ask()); } catch (error) { return "threw " + error.name; } }
function E9() {} function M9() {}
Object.setPrototypeOf(M9.prototype, E9.prototype);
class L9 extends M9 {}
const l9 = new L9();
told(() => { E9.prototype.who = function () { return "added"; }; });
console.log(told(() => l9.who()), told(() => "who" in l9), told(() => new L9().who()), told(() => nobodyKnows(l9)));

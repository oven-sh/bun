// A member of the prototype object of a constructor function that nothing constructs is deleted, and the one above it shows.
// The change and every question stand in callbacks, and the object also goes to a function that nobody knows: prototype-linked-anew-before-anything-asked-for-its-link.js says why.
function told(ask) { try { return String(ask()); } catch (error) { return "threw " + error.name; } }
function T11() {} T11.prototype.who = function () { return "top"; };
function E11() {} E11.prototype.who = function () { return "nearer"; };
Object.setPrototypeOf(E11.prototype, T11.prototype);
function M11() {}
Object.setPrototypeOf(M11.prototype, E11.prototype);
class L11 extends M11 {}
const l11 = new L11();
told(() => { delete E11.prototype.who; });
console.log(told(() => l11.who()), told(() => new L11().who()), told(() => nobodyKnows(l11)));

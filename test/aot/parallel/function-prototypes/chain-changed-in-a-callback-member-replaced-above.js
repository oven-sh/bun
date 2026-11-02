// A member of the prototype object of a constructor function that nothing constructs is replaced.
// The change and every question stand in callbacks, and the object also goes to a function that nobody knows: prototype-linked-anew-before-anything-asked-for-its-link.js says why.
function told(ask) { try { return String(ask()); } catch (error) { return "threw " + error.name; } }
function E10() {} E10.prototype.who = function () { return "first"; };
function M10() {}
Object.setPrototypeOf(M10.prototype, E10.prototype);
class L10 extends M10 {}
const l10 = new L10();
told(() => { E10.prototype.who = function () { return "second"; }; });
console.log(told(() => l10.who()), told(() => new L10().who()), told(() => nobodyKnows(l10)));

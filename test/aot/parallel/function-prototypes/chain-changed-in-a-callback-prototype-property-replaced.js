// The `prototype` property of a constructor function is replaced before its first object.
// The change and every question stand in callbacks, and the object also goes to a function that nobody knows: prototype-linked-anew-before-anything-asked-for-its-link.js says why.
function told(ask) { try { return String(ask()); } catch (error) { return "threw " + error.name; } }
function Old() {} Old.prototype.who = function () { return "old"; };
class Base5 { who() { return "base5"; } }
told(() => { Old.prototype = Object.create(Base5.prototype); });
const made = new Old();
console.log(told(() => made.who()), told(() => made instanceof Base5), told(() => made instanceof Old), told(() => nobodyKnows(made)));

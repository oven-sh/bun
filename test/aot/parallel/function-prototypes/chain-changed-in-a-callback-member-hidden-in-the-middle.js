// A member is hidden by a new one on the prototype object in the middle of the chain.
// The change and every question stand in callbacks, and the object also goes to a function that nobody knows: prototype-linked-anew-before-anything-asked-for-its-link.js says why.
function told(ask) { try { return String(ask()); } catch (error) { return "threw " + error.name; } }
function E12() {} E12.prototype.who = function () { return "above"; };
function M12() {}
Object.setPrototypeOf(M12.prototype, E12.prototype);
class L12 extends M12 {}
const l12 = new L12();
told(() => { M12.prototype.who = function () { return "middle"; }; });
console.log(told(() => l12.who()), told(() => new L12().who()), told(() => nobodyKnows(l12)));

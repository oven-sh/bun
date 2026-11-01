// The link in the middle of a chain of constructor functions changes before anything is constructed.
// The change and every question stand in callbacks, and the object also goes to a function that nobody knows: prototype-linked-anew-before-anything-asked-for-its-link.js says why.
function told(ask) { try { return String(ask()); } catch (error) { return "threw " + error.name; } }
function Top() {} Top.prototype.who = function () { return "top"; };
function Other() {} Other.prototype.who = function () { return "other"; };
function Mid() {}
Object.setPrototypeOf(Mid.prototype, Top.prototype);
class Low extends Mid {}
told(() => { Object.setPrototypeOf(Mid.prototype, Other.prototype); });
const low = new Low();
console.log(told(() => low.who()), told(() => low instanceof Top), told(() => low instanceof Other), told(() => nobodyKnows(low)));

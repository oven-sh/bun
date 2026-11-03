// The static side, two levels up: the parent of a function that is never called gets another parent.
// The change and every question stand in callbacks, and the object also goes to a function that nobody knows: prototype-linked-anew-before-anything-asked-for-its-link.js says why.
function told(ask) { try { return String(ask()); } catch (error) { return "threw " + error.name; } }
function R16() {} function K16() {}
Object.setPrototypeOf(K16, R16);
class Leaf16 extends K16 {}
function New16() {} New16.make = function () { return "new"; };
told(() => { Object.setPrototypeOf(R16, New16); });
console.log(told(() => Leaf16.make()), told(() => typeof K16.make), told(() => nobodyKnows(Leaf16)));

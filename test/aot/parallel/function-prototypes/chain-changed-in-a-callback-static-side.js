// The static side: a constructor function gets another parent, and a class below it is asked for a static method.
// The change and every question stand in callbacks, and the object also goes to a function that nobody knows: prototype-linked-anew-before-anything-asked-for-its-link.js says why.
function told(ask) { try { return String(ask()); } catch (error) { return "threw " + error.name; } }
function Root() {} Root.make = function () { return "root"; };
function Else() {} Else.make = function () { return "else"; };
function Kid() {}
Object.setPrototypeOf(Kid, Root);
class Leaf extends Kid {}
told(() => { Object.setPrototypeOf(Kid, Else); });
console.log(told(() => Leaf.make()), told(() => Kid.make()), told(() => nobodyKnows(Leaf)));

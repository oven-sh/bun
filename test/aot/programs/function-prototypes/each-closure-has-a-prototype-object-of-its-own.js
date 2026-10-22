// A function expression is evaluated twice: the two functions have two prototype objects, and a method stored on one is not found through the other.
function define() { return function Meter() {}; }
const first = define(), second = define();
first.prototype.read = function () { return "first"; };
const a = new first(), b = new second();
console.log(first.prototype === second.prototype, typeof a.read, typeof b.read, a instanceof second, b instanceof second, first.prototype.constructor === first, second.prototype.constructor === first);

// A class that extends a constructor function is constructed for a bound function that was given a `prototype`: the method of that object is called on what is made.
function Legacy() {}
const bound = function () {}.bind();
bound.prototype = { peek() { return "peeked"; } };
class Below extends Legacy {}
console.log(Reflect.construct(Below, [], bound).peek());

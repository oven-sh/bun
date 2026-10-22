// What a constructor function makes for a bound function lies under the object that the bound function was given as `prototype`: a method replaced by way of the new object is replaced on that object.
function Legacy() {}
const bound = function () {}.bind();
const above = { peek() { return 1; } };
bound.prototype = above;
const made = Reflect.construct(Legacy, [], bound);
Object.getPrototypeOf(made).peek = () => "patched";
console.log(String(above.peek()), String(made.peek()));

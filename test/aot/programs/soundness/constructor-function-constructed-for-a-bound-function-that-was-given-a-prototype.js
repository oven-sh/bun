// Reflect.construct(Legacy, [], bound) hands Legacy a `this` that inherits from bound.prototype. A bound function has no `prototype` until the program gives it one.
function Legacy() {
  console.log(typeof this.peek, this.mark);
}
const bound = function () {}.bind();
bound.prototype = { peek() { return "peeked"; }, mark: "from the prototype of bound" };
const made = Reflect.construct(Legacy, [], bound);
console.log(made.peek(), made.mark, Object.getPrototypeOf(made) === bound.prototype, made instanceof Legacy);

// Without the property the object inherits from Object.prototype.
const bare = function () {}.bind();
const plain = Reflect.construct(Legacy, [], bare);
console.log(Object.getPrototypeOf(plain) === Object.prototype, typeof plain.hasOwnProperty);

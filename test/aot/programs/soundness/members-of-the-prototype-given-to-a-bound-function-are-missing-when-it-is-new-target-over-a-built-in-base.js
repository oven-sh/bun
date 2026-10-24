// Reflect.construct(A, [], B) makes an object that inherits from B.prototype. B is a bound function: it has no `prototype` until the program gives it one.
class A extends Object {
  constructor() {
    super();
    console.log(typeof this.peek, this.mark);
  }
}
const B = function () {}.bind();
B.prototype = { peek() {}, mark: "from the prototype of B" };
const made = Reflect.construct(A, [], B);
console.log(typeof made.peek, made.mark, Object.getPrototypeOf(made) === B.prototype, made instanceof A);

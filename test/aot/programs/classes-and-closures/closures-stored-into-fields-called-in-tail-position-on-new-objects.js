// Every level of a deep recursion makes a new object and calls, in tail position and by name, a member of it that holds a function nobody has read. A tail call leaves no frame behind:
// neither the caller's nor one of the code that finds the member. A hundred thousand levels are more frames than the stack has room for.
// What comes out of evaluated text is a value that the compiler knows nothing about.
const hide = new Function("value", "return value");
class Ping {
  constructor(other) {
    this.other = other;
  }
  go = n => (n === 0 ? "done" : step(hide(new Ping(this.other)), n - 1));
}
function step(object, n) {
  return object.go(n);
}
console.log("new objects", step(hide(new Ping(null)), 100000));

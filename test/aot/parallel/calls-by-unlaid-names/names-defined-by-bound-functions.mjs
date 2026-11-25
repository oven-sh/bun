// A method stored on the prototype of a string by a bound function of the library is called with the argument of a call by that name.
class V {
  constructor(x) {
    this.x = x;
  }
  combine(other) {
    return this.x + other.x;
  }
}
const method = function (other) {
  other.x = "stored";
  return 7;
};
const held = [new V(1), "a", new V(2)];
function run() {
  const said = [];
  for (const value of held) {
    const argument = new V(5);
    let result;
    try {
      result = value.combine(argument);
    } catch (error) {
      result = error.constructor.name;
    }
    said.push(result, argument.x, argument.x * 2);
  }
  return said.join();
}
console.log(run());
const set = Reflect.set.bind(null, "a".__proto__);
set("combine", method);
console.log(run());

// A method that a function of the library copies onto what `__proto__` gives off a number is called with the argument of a call by that name.
const util = require("util");
class V {
  constructor(x) {
    this.x = x;
  }
  combine(other) {
    return this.x + other.x;
  }
}
const method = function (other) {
  other.x = "copied";
  return 7;
};
const held = [new V(1), 3, new V(2)];
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
util._extend((3).__proto__, { combine: method });
console.log(run());

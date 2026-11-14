// A method stored on what `__proto__` gives off a number is handed the argument of a call by that name.
class V {
  constructor(x) {
    this.x = x;
  }
  combine(other) {
    return this.x + other.x;
  }
}
const items = [new V(1), 3, new V(2)];
function run() {
  const said = [];
  for (const item of items) {
    const argument = new V(5);
    let result;
    try {
      result = item.combine(argument);
    } catch (error) {
      result = error.constructor.name;
    }
    said.push(result, argument.x, argument.x * 2);
  }
  return said.join();
}
console.log(run());
(1).__proto__.combine = function (other) {
  other.x = "stored";
  return 7;
};
console.log(run());
for (let i = 0; i < 200; i++) run();
console.log(run());

// `sum += object.total()` in a loop, `object` one instance of a class below a built-in class: `this.count` is asked for once, ahead of the loop. In the middle of the loop the instance comes out of a list and is another one later. Each turn reads what plain Bun reads.
let calls = 0;
let target;
class Made extends Array {
  count = 1;
  total() {
    return this.count;
  }
  storeAbove(value) {
    super.count = value;
  }
}
class Longer extends Made {
  more = 2;
}
function run(object, later, turns) {
  const objects = [object, later];
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += objects[i < 500 ? 0 : 1].total();
  return sum;
}
const object = new Made();
target = object;
const sum = run(object, Object.assign(new Longer(), { count: 9 }), 1000);
console.log(sum, calls, String(Object.getOwnPropertyDescriptor(object, "count")?.value), Object.keys(object).join());

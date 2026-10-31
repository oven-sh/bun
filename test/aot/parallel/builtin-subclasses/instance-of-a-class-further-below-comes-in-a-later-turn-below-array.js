// `sum += object.total()` in a loop, `object` one instance of a class below a built-in class: `this.count` is asked for once, ahead of the loop. In the middle of the loop an instance of a class further below comes in a later turn. Each turn reads what plain Bun reads.
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
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    if (i === 60) object = later;
    sum += object.total();
  }
  return sum;
}
const object = new Made();
target = object;
const sum = run(object, Object.assign(new Longer(), { count: 9 }), 1000);
console.log(sum, calls, String(Object.getOwnPropertyDescriptor(object, "count")?.value), Object.keys(object).join());

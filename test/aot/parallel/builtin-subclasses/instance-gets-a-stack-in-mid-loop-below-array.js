// `sum += object.total()` in a loop, `object` one instance of a class below a built-in class: `this.count` is asked for once, ahead of the loop. In the middle of the loop the instance gets a stack now and then. Each turn reads what plain Bun reads.
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
function run(object, alias, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    sum += object.total();
    if ((i & 255) === 7) Error.captureStackTrace(alias);
  }
  return sum;
}
const object = new Made();
target = object;
const sum = run(object, object, 1000);
console.log(sum, calls, String(Object.getOwnPropertyDescriptor(object, "count")?.value), Object.keys(object).join());

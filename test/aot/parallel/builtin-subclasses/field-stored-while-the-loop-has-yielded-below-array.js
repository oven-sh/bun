// `sum += object.total()` in a loop, `object` one instance of a class below a built-in class: `this.count` is asked for once, ahead of the loop. In the middle of the loop the field is stored while the loop has yielded. Each turn reads what plain Bun reads.
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
function* steps(object, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    sum += object.total();
    yield sum;
  }
}
function run(object, turns) {
  let last = 0;
  for (const sum of steps(object, turns)) {
    last = sum;
    if (sum === 30) object.count = 3;
  }
  return last;
}
const object = new Made();
target = object;
const sum = run(object, 1000);
console.log(sum, calls, String(Object.getOwnPropertyDescriptor(object, "count")?.value), Object.keys(object).join());

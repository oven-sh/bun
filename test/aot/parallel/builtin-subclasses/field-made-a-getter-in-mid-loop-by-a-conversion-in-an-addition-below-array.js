// `sum += object.total()` in a loop, `object` one instance of a class below a built-in class: `this.count` is asked for once, ahead of the loop. In the middle of the loop the field becomes a getter by a conversion in an addition. Each turn reads what plain Bun reads.
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
const odd = { valueOf() { Object.defineProperty(target, "count", { get() { return ++calls; }, configurable: true }); return 1; } };
const values = [];
for (let i = 0; i < 64; i++) values.push(i === 40 ? odd : 1);
function run(object, values, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    sum += object.total();
    sum += values[i & 63];
  }
  return sum;
}
const object = new Made();
target = object;
const sum = run(object, values, 1000);
console.log(sum, calls, String(Object.getOwnPropertyDescriptor(object, "count")?.value), Object.keys(object).join());

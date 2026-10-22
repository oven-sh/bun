let calls = 0;
class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const first = [1.5, item, "two"];
class Special extends Promise {
  count = 0;
  then(firstValue, secondValue, thirdValue) {
    calls++;
    this.count++;
    console.log("then", arguments.length, typeof firstValue, typeof secondValue, typeof thirdValue);
    return super.then(...arguments);
  }
}
const result = Special.allSettled(first);
const settled = await result;
console.log(Array.isArray(settled), settled.length, typeof settled[0], Object.keys(settled[0]).join());
console.log(typeof settled[0].status, settled[0].status.length, settled[0].status, typeof settled[0].value, settled[0].value + 1);
console.log(typeof settled[1], Object.keys(settled[1]).join(), typeof settled[1].status, settled[1].status.length, settled[1].status);
console.log(settled[1].value === item, settled[1].value.double(), typeof settled[2], Object.keys(settled[2]).join());
console.log(typeof settled[2].status, settled[2].status.length, settled[2].status);
console.log(typeof settled[2].value, settled[2].value.length, settled[2].value);
console.log(result instanceof Special, calls, result.count);

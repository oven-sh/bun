class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const set = new Set([1.5, item]);
const result = set.values();
console.log(typeof result);
const step = result.next();
console.log(step.done, typeof step.value, step.value + 1, [...result].length);

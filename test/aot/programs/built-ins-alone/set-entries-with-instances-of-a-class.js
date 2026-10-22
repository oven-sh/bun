class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const set = new Set([item]);
const result = set.entries();
console.log(typeof result);
const step = result.next();
console.log(step.done, Array.isArray(step.value), step.value.length, step.value[0] === item, step.value[0].double());
console.log(step.value[1] === item, step.value[1].double(), [...result].length);

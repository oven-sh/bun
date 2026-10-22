class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const list = [item, item, item];
const result = list.keys();
console.log(typeof result);
const step = result.next();
console.log(step.done, typeof step.value, step.value + 1, 1 / step.value, [...result].length);

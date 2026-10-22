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
const result = list.values();
console.log(typeof result);
const step = result.next();
console.log(step.done, step.value === item, step.value.double(), [...result].length);

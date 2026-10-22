class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const map = new Map([["first", item], ["second", item]]);
const result = map.keys();
console.log(typeof result);
const step = result.next();
console.log(step.done, typeof step.value, step.value.length, step.value, [...result].length);

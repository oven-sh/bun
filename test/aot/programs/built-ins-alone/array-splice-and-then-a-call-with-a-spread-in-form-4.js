class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const list = [1.5, item, "two"];
const third = [1.5, item, "two"];
const held = list.splice(1, 2, third, "x");
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return value instanceof Item ? value.double() : typeof value;
}
function use(first, second, third) {
  console.log(show(first), show(second), show(third));
}
use(...held);

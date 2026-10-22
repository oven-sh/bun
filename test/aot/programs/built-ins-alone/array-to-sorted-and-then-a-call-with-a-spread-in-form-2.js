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
function callback() {
  return new Item(2.5);
}
const held = list.toSorted(callback);
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return value instanceof Item ? value.double() : typeof value;
}
function use(first, second, third) {
  console.log(show(first), show(second), show(third));
}
use(...held);

class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const first = [["first", 1.5], ["second", item]];
const held = new Object(first);
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return value instanceof Item ? value.double() : typeof value;
}
held.forEach(value => console.log(show(value)));

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
const first = { first: 1.5, second: "two", third: item };
const held = list.concat(first, "an");
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return value instanceof Item ? value.double() : typeof value;
}
for (const [key, value] of Object.entries(held)) console.log(key, show(value));

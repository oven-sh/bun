class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = { first: item, second: item };
const held = subject.valueOf();
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return value instanceof Item ? value.double() : typeof value;
}
const copy = Object.assign({}, held);
for (const key in copy) console.log(key, show(copy[key]));

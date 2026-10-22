class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = new DisposableStack();
const first = [1.5, item, "two"];
function callback() {
  return new Item(2.5);
}
const held = subject.adopt(first, callback);
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return value instanceof Item ? value.double() : typeof value;
}
for (const value of [].concat(held)) console.log(show(value));

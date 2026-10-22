class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = new AsyncDisposableStack();
const first = { first: 1.5, second: "two", third: item };
function callback() {
  return new Item(2.5);
}
const held = subject.adopt(first, callback);
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return value instanceof Item ? value.double() : typeof value;
}
for (const value of Object.values(held)) console.log(show(value));

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
const first = { first: 1.5, second: "two", third: item };
function callback() {
  return { made: 1.5 };
}
const held = subject.adopt(first, callback);
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return value instanceof Item ? value.double() : typeof value;
}
const copy = Object.assign({}, held);
for (const key in copy) console.log(key, show(copy[key]));

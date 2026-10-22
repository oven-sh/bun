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
const first = [1.5, item, "two"];
function callback() {
  return { made: 1.5 };
}
const held = subject.adopt(first, callback);
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return value instanceof Item ? value.double() : typeof value;
}
for (let index = 0; index < held.length; index++) console.log(show(held[index]));

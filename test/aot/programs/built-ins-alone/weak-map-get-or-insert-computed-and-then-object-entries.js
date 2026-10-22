class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const key = { name: 1 };
const subject = new WeakMap([[key, item]]);
const first = { first: 1.5, second: "two", third: item };
function callback() {
  return { made: 1.5 };
}
const held = subject.getOrInsertComputed(first, callback);
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return typeof value === "object" || typeof value === "function" ? typeof value : `${typeof value} ${String(value)}`;
}
for (const [key, value] of Object.entries(held)) console.log(key, show(value));

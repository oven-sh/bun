class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = [1.5, item, "two"].values();
function callback() {
  return { made: 1.5 };
}
const held = subject.reduce(callback, 2.5);
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return typeof value === "object" || typeof value === "function" ? typeof value : `${typeof value} ${String(value)}`;
}
const copy = Object.assign({}, held);
for (const key in copy) console.log(key, show(copy[key]));

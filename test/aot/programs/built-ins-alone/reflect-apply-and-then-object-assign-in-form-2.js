class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const third = { first: 1.5, second: "two", third: item };
function callback() {
  return { made: 1.5 };
}
const held = Reflect.apply(callback, 2.5, third);
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return typeof value === "object" || typeof value === "function" ? typeof value : `${typeof value} ${String(value)}`;
}
const copy = Object.assign({}, held);
for (const key in copy) console.log(key, show(copy[key]));

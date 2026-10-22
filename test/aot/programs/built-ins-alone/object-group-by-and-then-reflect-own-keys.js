class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const first = [1.5, item, "two"];
function callback() {
  return { made: 1.5 };
}
const held = Object.groupBy(first, callback);
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return value instanceof Item ? value.double() : typeof value;
}
for (const key of Reflect.ownKeys(held)) console.log(String(key), show(Reflect.get(held, key)));

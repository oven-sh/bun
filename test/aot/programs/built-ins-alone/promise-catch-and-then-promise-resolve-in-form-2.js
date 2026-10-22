class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const promise = new Promise(resolve => resolve(item));
function callback() {
  return new Item(2.5);
}
const held = promise.catch(callback);
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return value instanceof Item ? value.double() : typeof value;
}
console.log(show(await Promise.resolve(held)));

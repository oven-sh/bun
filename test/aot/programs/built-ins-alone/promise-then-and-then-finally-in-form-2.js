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
const second = { first: 1.5, second: "two", third: item };
function callback() {
  return new Item(2.5);
}
const held = promise.then(callback, second);
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return value instanceof Item ? value.double() : typeof value;
}
console.log(show(await held.finally(() => {})));

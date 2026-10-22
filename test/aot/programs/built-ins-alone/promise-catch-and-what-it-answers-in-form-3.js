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
const first = { first: 1.5, second: "two", third: item };
const result = promise.catch(first);
const settled = await result;
console.log(settled === item, settled.double());

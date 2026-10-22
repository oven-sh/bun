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
const first = [1.5, item, "two"];
const result = promise.finally(first);
const settled = await result;
console.log(settled === item, settled.double());

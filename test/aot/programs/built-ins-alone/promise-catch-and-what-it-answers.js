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
const result = promise.catch(1.5);
const settled = await result;
console.log(settled === item, settled.double());

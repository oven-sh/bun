class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const result = Promise.resolve(item);
const settled = await result;
console.log(settled === item, settled.double());

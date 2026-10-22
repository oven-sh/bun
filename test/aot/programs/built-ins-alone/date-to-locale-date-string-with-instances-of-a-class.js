class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const date = new Date(86400000.5);
const result = date.toLocaleDateString(item, item);
console.log(typeof result);

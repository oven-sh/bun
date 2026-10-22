class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const list = [item, item, item];
const result = list.indexOf(item, 2);
console.log(typeof result, result + 1);

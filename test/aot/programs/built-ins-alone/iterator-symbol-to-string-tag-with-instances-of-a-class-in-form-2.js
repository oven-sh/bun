class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const list = [1.5, item, "two"];
list[Symbol.toStringTag] = item;
console.log(list[Symbol.toStringTag] === item, list[Symbol.toStringTag].double());

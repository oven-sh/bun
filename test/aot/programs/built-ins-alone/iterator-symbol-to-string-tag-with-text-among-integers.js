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
list[Symbol.toStringTag] = "text";
console.log(typeof list[Symbol.toStringTag], list[Symbol.toStringTag].length, list[Symbol.toStringTag]);

class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const result = Object.setPrototypeOf(item, null);
console.log(result === item, typeof item, Object.keys(item).join(), typeof item.size, item.size + 1);

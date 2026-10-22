class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const result = Bun.stringWidth("an", item);
console.log(typeof result, result + 1);

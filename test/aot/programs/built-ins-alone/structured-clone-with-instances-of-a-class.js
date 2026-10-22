class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const result = structuredClone(item, item);
console.log(typeof result, Object.keys(result).join(), typeof result.size, result.size + 1);

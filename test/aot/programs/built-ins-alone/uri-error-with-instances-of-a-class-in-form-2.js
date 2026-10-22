class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const result = new URIError("an", item);
console.log(result instanceof URIError, result.message);

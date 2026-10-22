class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const result = Response.json(item, item);
console.log(result instanceof Response, Object.keys(result).join());

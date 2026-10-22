class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const second = [1.5, item, "two"];
const result = new Response(null, second);
console.log(result instanceof Response, Object.keys(result).join());

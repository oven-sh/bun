class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const first = new ArrayBuffer(0);
const second = { first: 1.5, second: "two", third: item };
const result = new Response(first, second);
console.log(result instanceof Response, Object.keys(result).join());

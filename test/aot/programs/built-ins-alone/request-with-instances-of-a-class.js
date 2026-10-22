class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const first = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
const result = new Request(first, item);
console.log(result instanceof Request, Object.keys(result).join());

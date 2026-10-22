class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const proxy = new Proxy({}, { get: () => new Item(1.5) });
console.log(proxy.anything.double());

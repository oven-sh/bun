class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const data = JSON.parse("[1.5]", (key, value) => (typeof value === "number" ? new Item(value) : value));
console.log(data[0].double());

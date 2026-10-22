class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
const result = subject.slice(item, item, item);
console.log(result instanceof Blob, Object.keys(result).join());

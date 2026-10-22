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
subject.name = item;
console.log(typeof subject.name, subject.name === undefined);

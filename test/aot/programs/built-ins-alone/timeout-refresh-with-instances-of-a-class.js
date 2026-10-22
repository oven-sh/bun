class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = setTimeout(() => {}, 0);
const result = subject.refresh(item, 1.5);
console.log(result === subject);

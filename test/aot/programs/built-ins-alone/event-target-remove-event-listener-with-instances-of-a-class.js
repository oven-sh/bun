class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = new EventTarget();
const result = subject.removeEventListener(item, null, item);
console.log(typeof result, result === undefined);

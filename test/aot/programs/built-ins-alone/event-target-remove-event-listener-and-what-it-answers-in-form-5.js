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
const first = [["first", 1.5], ["second", item]];
const result = subject.removeEventListener(first, null, 3.5);
console.log(typeof result, result === undefined);

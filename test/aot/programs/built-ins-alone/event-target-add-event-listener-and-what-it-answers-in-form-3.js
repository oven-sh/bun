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
const second = [1.5, item, "two"];
const result = subject.addEventListener("an", second, 3.5);
console.log(typeof result, result === undefined);

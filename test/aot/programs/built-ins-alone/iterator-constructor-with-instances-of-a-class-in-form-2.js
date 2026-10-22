class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = [item, item].values();
subject.constructor = item;
console.log(subject.constructor === item, subject.constructor.double());

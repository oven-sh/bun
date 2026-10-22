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
subject._idleStart = item;
console.log(subject._idleStart === item, subject._idleStart.double());

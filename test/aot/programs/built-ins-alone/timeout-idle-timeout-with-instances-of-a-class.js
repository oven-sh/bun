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
subject._idleTimeout = item;
console.log(subject._idleTimeout === item, subject._idleTimeout.double());

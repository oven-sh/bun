class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = performance;
subject.onresourcetimingbufferfull = item;
console.log(subject.onresourcetimingbufferfull === item, subject.onresourcetimingbufferfull.double());

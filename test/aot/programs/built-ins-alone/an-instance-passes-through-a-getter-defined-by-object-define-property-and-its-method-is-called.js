class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const holder = Object.defineProperty({}, "held", { get: () => new Item(1.5) });
console.log(holder.held.double());

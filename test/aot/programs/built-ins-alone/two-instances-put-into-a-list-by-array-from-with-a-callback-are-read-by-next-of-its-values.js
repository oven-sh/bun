class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = Array.from({ length: 2 }, (value, index) => (index === 0 ? new Item(1.5) : new Item(7)));
const steps = held.values();
console.log(steps.next().value.double(), steps.next().value.double());

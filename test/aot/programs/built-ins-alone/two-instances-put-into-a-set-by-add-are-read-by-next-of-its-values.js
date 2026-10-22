class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = new Set();
held.add(new Item(1.5));
held.add(new Item(7));
const steps = held.values();
console.log(steps.next().value.double(), steps.next().value.double());
console.log(steps.next().value === undefined);

class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [];
held.push(new Item(1.5));
held.push(new Item(7));
const steps = held.values();
console.log(steps.next().value.double(), steps.next().value.double());

class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = new Map();
held.set("a", new Item(1.5));
held.set("b", null);
const steps = held.values();
console.log(steps.next().value.double(), steps.next().value === null);

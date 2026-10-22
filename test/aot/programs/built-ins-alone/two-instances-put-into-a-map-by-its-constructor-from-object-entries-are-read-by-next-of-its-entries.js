class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = new Map(Object.entries({ a: new Item(1.5), b: new Item(7) }));
const steps = held.entries();
console.log(steps.next().value[1].double(), steps.next().value[1].double());

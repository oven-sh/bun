class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const kept = new Item(1.5);
console.log([kept].includes(kept), [kept].indexOf(kept), [new Item(1.5)].includes(kept), kept.double());

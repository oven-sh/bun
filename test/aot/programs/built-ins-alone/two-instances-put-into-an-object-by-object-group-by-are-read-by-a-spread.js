class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const groups = Object.groupBy([new Item(1.5), new Item(7)], (value, index) => (index === 0 ? "a" : "b"));
const held = { a: groups.a[0], b: groups.b[0] };
const copy = { ...held };
console.log(copy.a.double(), copy.b.double());

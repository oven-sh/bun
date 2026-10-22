class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
class Label extends Item {
  toString() {
    return `label ${this.double()}`;
  }
}
console.log("a-b".replace("-", () => new Label(1.5)));

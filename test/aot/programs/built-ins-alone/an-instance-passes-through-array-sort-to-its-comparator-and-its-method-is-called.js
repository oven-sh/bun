class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const list = [new Item(2.5), new Item(1.5)];
list.sort((left, right) => left.double() - right.double());
console.log(list[0].size);

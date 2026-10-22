class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [Promise.resolve(new Item(1.5)), Promise.resolve(null)];
const list = await Array.fromAsync(held);
console.log(list.length);
console.log(list[0].double(), list[1] === null);

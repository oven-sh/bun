class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const list = [1.5, item, "two"];
list.caller = 1.5;
console.log(typeof list.caller, list.caller + 1);

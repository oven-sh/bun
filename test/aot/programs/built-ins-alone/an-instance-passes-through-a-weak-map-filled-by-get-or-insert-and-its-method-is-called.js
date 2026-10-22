class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const key = {};
const notes = new WeakMap();
console.log(notes.getOrInsert(key, new Item(1.5)).double(), notes.get(key).double());

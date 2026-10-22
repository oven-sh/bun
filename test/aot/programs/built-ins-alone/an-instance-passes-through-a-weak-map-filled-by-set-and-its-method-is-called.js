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
notes.set(key, new Item(1.5));
console.log(notes.get(key).double());

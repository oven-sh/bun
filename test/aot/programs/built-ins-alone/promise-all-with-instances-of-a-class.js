class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const result = Promise.all(item);
let reason;
try {
  await result;
} catch (error) {
  reason = error;
}
console.log(reason instanceof TypeError, reason.message);

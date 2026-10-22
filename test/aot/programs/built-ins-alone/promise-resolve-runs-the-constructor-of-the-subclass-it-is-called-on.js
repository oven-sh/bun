let calls = 0;
class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const first = new Promise(resolve => resolve(item));
class Special extends Promise {
  constructor(...passed) {
    super(...passed);
    calls++;
    console.log("constructor", passed.length, typeof passed[0], new.target === Special);
  }
}
const result = Special.resolve(first);
const settled = await result;
console.log(settled === item, settled.double());
console.log(result instanceof Special, calls);

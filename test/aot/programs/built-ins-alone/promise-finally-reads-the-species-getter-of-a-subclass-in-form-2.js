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
class Special extends Promise {
  static count = 0;
  static get [Symbol.species]() {
    calls++;
    this.count++;
    console.log("Symbol.species", this === Special);
    return Promise;
  }
}
const special = new Special(resolve => resolve(item));
console.log("made");
const result = special.finally("an");
const settled = await result;
console.log(settled.double());
console.log(calls, Special.count);

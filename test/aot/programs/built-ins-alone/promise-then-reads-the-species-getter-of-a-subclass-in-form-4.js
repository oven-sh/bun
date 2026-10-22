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
function callback() {
  console.log("callback", arguments.length);
  return true;
}
console.log("made");
const result = special.then(1.5, callback);
const settled = await result;
console.log(settled.double());
console.log(calls, Special.count);

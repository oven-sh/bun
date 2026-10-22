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
const second = { first: 1.5, second: "two", third: item };
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
function callback(firstValue) {
  console.log("callback", typeof firstValue, firstValue, this === undefined, arguments.length);
  return true;
}
console.log("made");
const result = special.then(callback, second);
const settled = await result;
console.log(typeof settled, settled);
console.log(calls, Special.count);

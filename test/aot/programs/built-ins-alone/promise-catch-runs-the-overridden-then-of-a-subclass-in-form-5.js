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
  then(firstValue, secondValue, thirdValue) {
    calls++;
    console.log("then", arguments.length, typeof firstValue, typeof secondValue, typeof thirdValue);
    return super.then(...arguments);
  }
}
const special = new Special(resolve => resolve(item));
console.log("made");
const result = special.catch("an");
const settled = await result;
console.log(settled.double());
console.log(calls);

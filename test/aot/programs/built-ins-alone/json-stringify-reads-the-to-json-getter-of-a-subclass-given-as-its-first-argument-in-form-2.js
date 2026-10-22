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
const third = { first: 1.5, second: "two", third: item };
class Special extends Array {
  count = 0;
  get toJSON() {
    calls++;
    this.count++;
    console.log("toJSON");
    return undefined;
  }
}
const special = new Special(1.5, item, "two");
function callback(firstValue, secondValue) {
  console.log("callback", typeof firstValue, firstValue.length, firstValue, secondValue === special, typeof this);
  console.log(arguments.length);
  return true;
}
console.log("made");
const result = JSON.stringify(special, callback, third);
console.log(typeof result, result.length, result, Array.isArray(special), special.length);
console.log(typeof special[0], special[0] + 1, special[1].double());
console.log(typeof special[2], special[2].length, special[2], typeof special.count, special.count + 1);
console.log(calls, special.count);

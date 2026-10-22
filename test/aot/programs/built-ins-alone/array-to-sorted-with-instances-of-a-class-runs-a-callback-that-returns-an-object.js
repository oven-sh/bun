class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const list = [item, item, item];
function callback(firstValue, secondValue) {
  console.log("callback", firstValue === item, firstValue.double(), secondValue === item, secondValue.double(), this === undefined);
  console.log(arguments.length);
  return { made: 1.5 };
}
const result = list.toSorted(callback);
console.log(Array.isArray(result), result.length, result[0] === item, result[0].double());
console.log(result[1] === item, result[1].double(), result[2] === item, result[2].double());

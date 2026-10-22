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
const result = list.sort(callback);
console.log(result === list);

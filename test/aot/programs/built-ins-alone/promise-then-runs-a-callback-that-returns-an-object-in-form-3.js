class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const promise = new Promise(resolve => resolve(item));
function callback(firstValue) {
  console.log("callback", firstValue === item, firstValue.double(), this === undefined, arguments.length);
  return { made: 1.5 };
}
const result = promise.then(callback, 2.5);
const settled = await result;
console.log(typeof settled, Object.keys(settled).join(), typeof settled.made, settled.made + 1);

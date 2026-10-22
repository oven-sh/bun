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
function callback() {
  console.log("callback", arguments.length);
  return new Item(2.5);
}
const result = promise.then("an", callback);
const settled = await result;
console.log(settled === item, settled.double());

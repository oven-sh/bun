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
  return "text";
}
const result = promise.catch(callback);
const settled = await result;
console.log(settled === item, settled.double());

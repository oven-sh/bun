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
const probe = {
  work: Array.prototype.every,
  get length() {
    calls++;
    console.log("length");
    return 3;
  },
  get 0() {
    calls++;
    console.log("element 0");
    return 1.5;
  },
  get 1() {
    calls++;
    console.log("element 1");
    return item;
  },
  get 2() {
    calls++;
    console.log("element 2");
    return "two";
  },
};
function callback(firstValue, secondValue, thirdValue) {
  console.log("callback", typeof firstValue, firstValue, typeof secondValue, secondValue + 1, thirdValue === probe);
  console.log(typeof this, arguments.length);
  return true;
}
const result = probe.work(callback, 2.5);
console.log(typeof result, result);
console.log(calls);

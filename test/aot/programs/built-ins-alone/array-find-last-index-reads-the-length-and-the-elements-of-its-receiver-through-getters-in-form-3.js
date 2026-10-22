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
const probe = {
  work: Array.prototype.findLastIndex,
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
  console.log("callback", typeof firstValue, firstValue.length, firstValue, typeof secondValue, secondValue + 1);
  console.log(thirdValue === probe, this === second, arguments.length);
  return true;
}
const result = probe.work(callback, second);
console.log(typeof result, result + 1);
console.log(calls);

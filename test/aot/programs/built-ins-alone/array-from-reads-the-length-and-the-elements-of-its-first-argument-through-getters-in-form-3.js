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
const probe = {
  count: 0,
  get length() {
    calls++;
    this.count++;
    console.log("length");
    return 3;
  },
  get 0() {
    calls++;
    this.count++;
    console.log("element 0");
    return 1.5;
  },
  get 1() {
    calls++;
    this.count++;
    console.log("element 1");
    return item;
  },
  get 2() {
    calls++;
    this.count++;
    console.log("element 2");
    return "two";
  },
};
function callback(firstValue, secondValue) {
  console.log("callback", typeof firstValue, firstValue, typeof secondValue, secondValue + 1, this === third);
  console.log(arguments.length);
  return true;
}
const result = Array.from(probe, callback, third);
console.log(Array.isArray(result), result.length, typeof result[0], result[0]);
console.log(typeof result[1], result[1], typeof result[2], result[2], typeof probe);
console.log(Object.keys(probe).join(), typeof probe[0], probe[0] + 1, probe[1].double());
console.log(typeof probe[2], probe[2].length, probe[2], typeof probe.count, probe.count + 1);
console.log(calls, probe.count);

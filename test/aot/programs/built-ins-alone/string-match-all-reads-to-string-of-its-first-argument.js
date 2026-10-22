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
  count: 0,
  first: 1.5,
  second: "two",
  third: item,
  toString() {
    calls++;
    this.count++;
    console.log("toString", this === probe);
    return "first";
  },
};
const result = "banana".matchAll(probe);
console.log(typeof result);
const step = result.next();
console.log(step.done, typeof step.value, step.value === undefined, [...result].length, typeof probe);
console.log(Object.keys(probe).join(), typeof probe.count, probe.count + 1, typeof probe.first, probe.first + 1);
console.log(typeof probe.second, probe.second.length, probe.second, probe.third.double());
console.log(calls, probe.count);

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
  get [Symbol.matchAll]() {
    calls++;
    this.count++;
    console.log("Symbol.matchAll", this === probe);
    return undefined;
  },
};
const result = "banana".matchAll(probe);
console.log(typeof result);
const step = result.next();
console.log(step.done, Array.isArray(step.value), step.value.length);
console.log(typeof step.value[0], step.value[0].length, step.value[0]);
console.log(typeof step.value.index, step.value.index + 1, 1 / step.value.index);
console.log(typeof step.value.input, step.value.input.length, step.value.input, typeof step.value.groups, step.value.groups === undefined);
console.log([...result].length, typeof probe, Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(typeof probe.first, probe.first + 1, typeof probe.second, probe.second.length, probe.second);
console.log(probe.third.double());
console.log(calls, probe.count);

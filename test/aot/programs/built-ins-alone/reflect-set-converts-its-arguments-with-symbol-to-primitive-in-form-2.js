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
const first = [1.5, item, "two"];
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return "-";
  },
};
const result = Reflect.set(first, probe, 3.5);
console.log(typeof result, result, Array.isArray(first), first.length);
console.log(typeof first[0], first[0] + 1, first[1] === item, first[1].double());
console.log(typeof first[2], first[2].length, first[2], typeof first["-"], first["-"] + 1);
console.log(typeof probe, Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(calls, probe.count);

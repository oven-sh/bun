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
const first = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
const probe = {
  count: 0,
  first: 1.5,
  second: "two",
  third: item,
  get body() {
    calls++;
    this.count++;
    console.log("body", this === probe);
    return undefined;
  },
};
const result = new Request(first, probe);
console.log(result instanceof Request, Object.keys(result).join(), typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1, typeof probe.first, probe.first + 1);
console.log(typeof probe.second, probe.second.length, probe.second, probe.third.double());
console.log(calls, probe.count);

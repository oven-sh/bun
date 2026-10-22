let calls = 0;
const subject = new URLSearchParams("first=1&second=two&first=3");
const probe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("probe valueOf", this === probe);
    return 1.5;
  },
  toString() {
    calls++;
    this.count++;
    console.log("probe toString", this === probe);
    return "1.5";
  },
};
const result = subject.getAll(probe);
console.log(Array.isArray(result), result.length, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1, typeof probe.valueOf, probe.valueOf.length);
console.log(typeof probe.toString, probe.toString.length);
console.log(calls, probe.count);

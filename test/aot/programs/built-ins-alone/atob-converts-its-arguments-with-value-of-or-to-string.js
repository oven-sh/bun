let calls = 0;
const probe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("probe valueOf", this === probe);
    return "YmFuYW5h";
  },
  toString() {
    calls++;
    this.count++;
    console.log("probe toString", this === probe);
    return "YmFuYW5h";
  },
};
const result = atob(probe);
console.log(typeof result, result.length, result, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1, typeof probe.valueOf, probe.valueOf.length);
console.log(typeof probe.toString, probe.toString.length);
console.log(calls, probe.count);

let calls = 0;
const probe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("probe valueOf", this === probe);
    return "x";
  },
  toString() {
    calls++;
    this.count++;
    console.log("probe toString", this === probe);
    return "x";
  },
};
const result = new SuppressedError(1.5, 2.5, probe);
console.log(result instanceof SuppressedError, result.message, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1, typeof probe.valueOf, probe.valueOf.length);
console.log(typeof probe.toString, probe.toString.length);
console.log(calls, probe.count);

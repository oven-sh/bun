let calls = 0;
const subject = new DataView(new ArrayBuffer(16));
const probe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("probe valueOf", this === probe);
    return 1;
  },
  toString() {
    calls++;
    this.count++;
    console.log("probe toString", this === probe);
    return "1";
  },
};
const result = subject.getFloat64(probe, true);
console.log(typeof result, result + 1, 1 / result, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1, typeof probe.valueOf, probe.valueOf.length);
console.log(typeof probe.toString, probe.toString.length);
console.log(calls, probe.count);

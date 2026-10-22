let calls = 0;
const probe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("probe valueOf", this === probe);
    return "unit";
  },
  toString() {
    calls++;
    this.count++;
    console.log("probe toString", this === probe);
    return "unit";
  },
};
const result = Intl.supportedValuesOf(probe);
console.log(Array.isArray(result), result.length, typeof result[0], typeof result[1], typeof result[2]);
console.log(typeof result[3], typeof probe, Object.keys(probe).join(), typeof probe.count);
console.log(typeof probe.valueOf, probe.valueOf.length, typeof probe.toString, probe.toString.length);
console.log(calls, probe.count);

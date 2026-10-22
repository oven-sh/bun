let calls = 0;
const probe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("probe valueOf", this === probe);
    return "an";
  },
  toString() {
    calls++;
    this.count++;
    console.log("probe toString", this === probe);
    return "an";
  },
};
const result = RegExp(probe);
console.log(result instanceof RegExp, result.source, result.flags, result.lastIndex, typeof probe);
console.log(Object.keys(probe).join(), typeof probe.count, probe.count + 1, typeof probe.valueOf, probe.valueOf.length);
console.log(typeof probe.toString, probe.toString.length);
console.log(calls, probe.count);

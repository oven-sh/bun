let calls = 0;
const probe = {
  count: 0,
  work: String.prototype.split,
  valueOf() {
    calls++;
    this.count++;
    console.log("probe valueOf", this === probe);
    return "banana";
  },
  toString() {
    calls++;
    this.count++;
    console.log("probe toString", this === probe);
    return "banana";
  },
};
const result = probe.work("n", 2);
console.log(Array.isArray(result), result.length, typeof result[0], result[0].length, result[0]);
console.log(typeof result[1], result[1].length, result[1], typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1, typeof probe.work, probe.work.length);
console.log(typeof probe.valueOf, probe.valueOf.length, typeof probe.toString, probe.toString.length);
console.log(calls, probe.count);

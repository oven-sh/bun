let calls = 0;
const probe = {
  count: 0,
  work: String.prototype.toLocaleUpperCase,
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
const result = probe.work("an");
console.log(typeof result, typeof probe, Object.keys(probe).join(), typeof probe.count);
console.log(typeof probe.work, probe.work.length, typeof probe.valueOf, probe.valueOf.length);
console.log(typeof probe.toString, probe.toString.length);
console.log(calls, probe.count);

let calls = 0;
const date = new Date(86400000.5);
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
const result = date.setUTCDate(probe);
console.log(typeof result, result + 1, 1 / result, date instanceof Date, date.getTime());
console.log(typeof probe, Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(typeof probe.valueOf, probe.valueOf.length, typeof probe.toString, probe.toString.length);
console.log(calls, probe.count);

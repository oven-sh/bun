let calls = 0;
const probe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("probe valueOf", this === probe);
    return "en";
  },
  toString() {
    calls++;
    this.count++;
    console.log("probe toString", this === probe);
    return "en";
  },
};
const result = new Intl.Locale(probe, 2.5);
console.log(typeof result, Object.keys(result).join(), typeof probe, Object.keys(probe).join(), typeof probe.count);
console.log(typeof probe.valueOf, probe.valueOf.length, typeof probe.toString, probe.toString.length);
console.log(calls, probe.count);

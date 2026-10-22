let calls = 0;
const subject = new Intl.NumberFormat("en");
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
const result = subject.format(probe);
console.log(typeof result, typeof probe, Object.keys(probe).join(), typeof probe.count);
console.log(typeof probe.valueOf, probe.valueOf.length, typeof probe.toString, probe.toString.length);
console.log(calls, probe.count);

let calls = 0;
const subject = new Uint8Array([1, 2, 3]);
const probe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("probe valueOf", this === probe);
    return 2;
  },
  toString() {
    calls++;
    this.count++;
    console.log("probe toString", this === probe);
    return "2";
  },
};
const result = subject.indexOf(1.5, probe);
console.log(typeof result, result + 1, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1, typeof probe.valueOf, probe.valueOf.length);
console.log(typeof probe.toString, probe.toString.length);
console.log(calls, probe.count);

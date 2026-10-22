let calls = 0;
const probe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("probe valueOf", this === probe);
    return "utf8";
  },
  toString() {
    calls++;
    this.count++;
    console.log("probe toString", this === probe);
    return "utf8";
  },
};
const result = new TextDecoder(probe);
console.log(typeof result, Object.keys(result).join(), typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1, typeof probe.valueOf, probe.valueOf.length);
console.log(typeof probe.toString, probe.toString.length);
console.log(calls, probe.count);

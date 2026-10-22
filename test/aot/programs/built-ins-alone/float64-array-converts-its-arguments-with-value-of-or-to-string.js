let calls = 0;
const first = new ArrayBuffer(8, { maxByteLength: 16 });
const probe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("probe valueOf", this === probe);
    return 0;
  },
  toString() {
    calls++;
    this.count++;
    console.log("probe toString", this === probe);
    return "0";
  },
};
const result = new Float64Array(first, probe);
console.log(result instanceof Float64Array, result.length, typeof result[0], result[0] + 1, 1 / result[0]);
console.log(typeof probe, Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(typeof probe.valueOf, probe.valueOf.length, typeof probe.toString, probe.toString.length);
console.log(calls, probe.count);

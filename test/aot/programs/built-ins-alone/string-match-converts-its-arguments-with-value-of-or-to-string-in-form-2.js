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
const result = "banana".match(probe);
console.log(Array.isArray(result), result.length, typeof result[0], result[0].length, result[0]);
console.log(typeof result.index, result.index + 1, typeof result.input, result.input.length, result.input);
console.log(typeof result.groups, result.groups === undefined, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1, typeof probe.valueOf, probe.valueOf.length);
console.log(typeof probe.toString, probe.toString.length);
console.log(calls, probe.count);

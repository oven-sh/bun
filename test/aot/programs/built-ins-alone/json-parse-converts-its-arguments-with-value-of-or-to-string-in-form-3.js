let calls = 0;
const probe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("probe valueOf", this === probe);
    return "{ \"first\": 1.5, \"second\": [\"two\"] }";
  },
  toString() {
    calls++;
    this.count++;
    console.log("probe toString", this === probe);
    return "{ \"first\": 1.5, \"second\": [\"two\"] }";
  },
};
const result = JSON.parse(probe, "-");
console.log(typeof result, Object.keys(result).join(), typeof result.first, result.first + 1);
console.log(Array.isArray(result.second), result.second.length, typeof result.second[0], result.second[0].length, result.second[0]);
console.log(typeof probe, Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(typeof probe.valueOf, probe.valueOf.length, typeof probe.toString, probe.toString.length);
console.log(calls, probe.count);

let calls = 0;
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return "{ \"first\": 1.5, \"second\": [\"two\"] }";
  },
};
const result = JSON.parse(probe, "-");
console.log(typeof result, Object.keys(result).join(), typeof result.first, result.first + 1);
console.log(Array.isArray(result.second), result.second.length, typeof result.second[0], result.second[0].length, result.second[0]);
console.log(typeof probe, Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(calls, probe.count);

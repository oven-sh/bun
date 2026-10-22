let calls = 0;
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return "1.5";
  },
};
const result = JSON.rawJSON(probe);
console.log(typeof result, Object.keys(result).join(), typeof result.rawJSON, result.rawJSON.length, result.rawJSON);
console.log(typeof probe, Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(calls, probe.count);

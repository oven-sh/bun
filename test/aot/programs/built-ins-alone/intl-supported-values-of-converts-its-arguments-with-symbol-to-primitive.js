let calls = 0;
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return "unit";
  },
};
const result = Intl.supportedValuesOf(probe);
console.log(Array.isArray(result), result.length, typeof result[0], typeof result[1], typeof result[2]);
console.log(typeof result[3], typeof probe, Object.keys(probe).join(), typeof probe.count);
console.log(calls, probe.count);

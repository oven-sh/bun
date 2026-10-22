let calls = 0;
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return "en";
  },
};
const result = new Intl.Locale(probe, 2.5);
console.log(typeof result, Object.keys(result).join(), typeof probe, Object.keys(probe).join(), typeof probe.count);
console.log(calls, probe.count);

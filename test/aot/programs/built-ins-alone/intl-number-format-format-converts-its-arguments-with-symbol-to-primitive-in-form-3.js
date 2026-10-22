let calls = 0;
const subject = new Intl.NumberFormat("en");
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return "an";
  },
};
const result = subject.format(probe);
console.log(typeof result, typeof probe, Object.keys(probe).join(), typeof probe.count);
console.log(calls, probe.count);

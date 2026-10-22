let calls = 0;
const probe = {
  count: 0,
  work: String.prototype.toLocaleUpperCase,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return "banana";
  },
};
const result = probe.work("an");
console.log(typeof result, typeof probe, Object.keys(probe).join(), typeof probe.count);
console.log(typeof probe.work, probe.work.length);
console.log(calls, probe.count);

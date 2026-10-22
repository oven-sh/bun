let calls = 0;
const probe = {
  count: 0,
  work: String.prototype.match,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return "banana";
  },
};
const result = probe.work(1.5);
console.log(result === null, typeof probe, Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(typeof probe.work, probe.work.length);
console.log(calls, probe.count);

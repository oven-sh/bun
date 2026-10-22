let calls = 0;
const subject = performance;
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return "an";
  },
};
const result = subject.setResourceTimingBufferSize(probe);
console.log(typeof result, result === undefined, typeof probe, Object.keys(probe).join(), typeof probe.count);
console.log(calls, probe.count);

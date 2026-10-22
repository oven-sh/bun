let calls = 0;
const subject = new DataView(new ArrayBuffer(16));
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return 1;
  },
};
const result = subject.getInt16(probe, true);
console.log(typeof result, result + 1, 1 / result, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1);
console.log(calls, probe.count);

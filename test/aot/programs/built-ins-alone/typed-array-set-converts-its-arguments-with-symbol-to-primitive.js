let calls = 0;
const subject = new Uint8Array([1, 2, 3]);
const first = new Uint8Array([1, 2, 3]);
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return 0;
  },
};
const result = subject.set(first, probe);
console.log(typeof result, result === undefined, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1);
console.log(calls, probe.count);

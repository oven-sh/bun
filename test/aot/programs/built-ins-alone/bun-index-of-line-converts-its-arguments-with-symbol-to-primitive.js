let calls = 0;
const first = new ArrayBuffer(8, { maxByteLength: 16 });
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return 2.5;
  },
};
const result = Bun.indexOfLine(first, probe);
console.log(typeof result, result + 1, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1);
console.log(calls, probe.count);

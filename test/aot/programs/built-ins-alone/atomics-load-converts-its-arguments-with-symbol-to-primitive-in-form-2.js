let calls = 0;
const first = new BigInt64Array([1n, 2n, 3n]);
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return 2;
  },
};
const result = Atomics.load(first, probe);
console.log(typeof result, result + 1n, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1);
console.log(calls, probe.count);

let calls = 0;
const first = new ArrayBuffer(8, { maxByteLength: 16 });
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return 0;
  },
};
const result = new BigUint64Array(first, probe);
console.log(result instanceof BigUint64Array, result.length, typeof result[0], result[0] + 1n, typeof probe);
console.log(Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(calls, probe.count);

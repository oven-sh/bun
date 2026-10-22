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
const result = new Int32Array(first, probe);
console.log(result instanceof Int32Array, result.length, typeof result[0], result[0] + 1, 1 / result[0]);
console.log(typeof result[1], result[1] + 1, 1 / result[1], typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1);
console.log(calls, probe.count);

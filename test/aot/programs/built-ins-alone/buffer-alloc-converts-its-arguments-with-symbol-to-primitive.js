let calls = 0;
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return 2.5;
  },
};
const result = Buffer.alloc(1.5, probe, 3.5);
console.log(result instanceof Buffer, result.length, typeof result[0], result[0] + 1, typeof probe);
console.log(Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(calls, probe.count);

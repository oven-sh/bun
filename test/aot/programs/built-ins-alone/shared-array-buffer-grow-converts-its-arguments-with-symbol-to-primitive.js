let calls = 0;
const subject = new SharedArrayBuffer(8, { maxByteLength: 16 });
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return 16;
  },
};
const result = subject.grow(probe);
console.log(typeof result, result === undefined, subject instanceof SharedArrayBuffer, subject.byteLength, typeof probe);
console.log(Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(calls, probe.count);

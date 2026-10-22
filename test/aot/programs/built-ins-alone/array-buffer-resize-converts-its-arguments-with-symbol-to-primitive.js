let calls = 0;
const subject = new ArrayBuffer(8, { maxByteLength: 16 });
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return 1;
  },
};
const result = subject.resize(probe);
console.log(typeof result, result === undefined, subject instanceof ArrayBuffer, subject.byteLength, typeof probe);
console.log(Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(calls, probe.count);

let calls = 0;
const subject = new TextEncoder();
const second = new DataView(new ArrayBuffer(16));
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return 1.5;
  },
};
const result = subject.encodeInto(probe, second);
console.log(typeof result, Object.keys(result).join(), typeof result.read, result.read + 1);
console.log(typeof result.written, result.written + 1, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1, second instanceof DataView, second.byteLength, second.byteOffset);
console.log(calls, probe.count);

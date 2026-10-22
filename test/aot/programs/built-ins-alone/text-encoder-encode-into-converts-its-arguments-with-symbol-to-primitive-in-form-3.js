let calls = 0;
const subject = new TextEncoder();
const second = new DataView(new ArrayBuffer(16));
const probe = {
  [Symbol.toPrimitive](hint) {
    calls++;
    console.log("probe toPrimitive", hint, this === probe);
    return "an";
  },
};
const result = subject.encodeInto(probe, second);
console.log(typeof result, Object.keys(result).join(), typeof result.read, result.read + 1);
console.log(typeof result.written, result.written + 1, second instanceof DataView, second.byteLength, second.byteOffset);
console.log(calls);

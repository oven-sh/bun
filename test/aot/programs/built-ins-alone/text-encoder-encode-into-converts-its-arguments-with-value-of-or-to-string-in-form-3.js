let calls = 0;
const subject = new TextEncoder();
const second = new DataView(new ArrayBuffer(16));
const probe = {
  valueOf() {
    calls++;
    console.log("probe valueOf", this === probe);
    return "an";
  },
  toString() {
    calls++;
    console.log("probe toString", this === probe);
    return "an";
  },
};
const result = subject.encodeInto(probe, second);
console.log(typeof result, Object.keys(result).join(), typeof result.read, result.read + 1);
console.log(typeof result.written, result.written + 1, second instanceof DataView, second.byteLength, second.byteOffset);
console.log(calls);

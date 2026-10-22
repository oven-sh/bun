const subject = new TextEncoder();
const second = new DataView(new ArrayBuffer(16));
const result = subject.encodeInto(1.5, second);
console.log(typeof result, Object.keys(result).join(), typeof result.read, result.read + 1);
console.log(typeof result.written, result.written + 1, second instanceof DataView, second.byteLength, second.byteOffset);

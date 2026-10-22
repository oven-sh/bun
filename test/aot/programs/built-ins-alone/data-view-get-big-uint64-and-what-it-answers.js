const subject = new DataView(new ArrayBuffer(16));
const result = subject.getBigUint64(1, true);
console.log(typeof result, result + 1n);

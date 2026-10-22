const subject = new Uint8Array(0);
const result = subject.setFromHex("an");
console.log(typeof result, Object.keys(result).join(), typeof result.read, result.read + 1, 1 / result.read);
console.log(typeof result.written, result.written + 1, 1 / result.written);

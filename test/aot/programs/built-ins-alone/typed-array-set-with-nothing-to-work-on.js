const subject = new Uint8Array(0);
const first = new Uint8Array(0);
const result = subject.set(first, 0);
console.log(typeof result, result === undefined);

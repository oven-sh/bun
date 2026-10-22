const subject = new Uint8Array(0);
const result = subject.set(1.5, 0);
console.log(typeof result, result === undefined);

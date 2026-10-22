const subject = new Blob([]);
const result = subject.stat();
console.log(typeof result, result === undefined);

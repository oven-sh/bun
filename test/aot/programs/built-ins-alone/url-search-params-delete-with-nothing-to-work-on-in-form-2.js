const subject = new URLSearchParams();
const result = subject.delete(1.5, 2.5);
console.log(typeof result, result === undefined);

const subject = new URLSearchParams();
const result = subject.getAll(1.5);
console.log(Array.isArray(result), result.length);

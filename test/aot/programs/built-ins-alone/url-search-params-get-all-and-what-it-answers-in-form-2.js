const subject = new URLSearchParams("first=1&second=two&first=3");
const result = subject.getAll(1.5);
console.log(Array.isArray(result), result.length);

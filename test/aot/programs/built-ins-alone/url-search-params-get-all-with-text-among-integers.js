const subject = new URLSearchParams("first=1&second=two&first=3");
const result = subject.getAll("text");
console.log(Array.isArray(result), result.length);

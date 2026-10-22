const subject = new URLSearchParams("first=1&second=two&first=3");
const result = subject.toString();
console.log(typeof result, result.length, result);

const subject = new URLSearchParams("first=1&second=two&first=3");
const result = subject.get(1.5);
console.log(result === null);

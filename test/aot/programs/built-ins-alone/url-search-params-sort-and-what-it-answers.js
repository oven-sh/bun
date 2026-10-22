const subject = new URLSearchParams("first=1&second=two&first=3");
const result = subject.sort();
console.log(typeof result, result === undefined);

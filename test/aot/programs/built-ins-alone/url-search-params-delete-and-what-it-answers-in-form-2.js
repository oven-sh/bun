const subject = new URLSearchParams("first=1&second=two&first=3");
const result = subject.delete(1.5, 2.5);
console.log(typeof result, result === undefined);

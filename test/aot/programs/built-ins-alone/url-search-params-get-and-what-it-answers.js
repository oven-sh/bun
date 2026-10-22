const subject = new URLSearchParams("first=1&second=two&first=3");
const result = subject.get("an");
console.log(result === null);

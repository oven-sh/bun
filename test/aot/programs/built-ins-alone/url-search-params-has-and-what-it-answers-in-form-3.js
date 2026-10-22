const subject = new URLSearchParams("first=1&second=two&first=3");
const result = subject.has("an", 2.5);
console.log(typeof result, result);

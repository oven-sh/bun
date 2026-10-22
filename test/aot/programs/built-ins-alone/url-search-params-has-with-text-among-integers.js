const subject = new URLSearchParams("first=1&second=two&first=3");
const result = subject.has("text", "text");
console.log(typeof result, result);

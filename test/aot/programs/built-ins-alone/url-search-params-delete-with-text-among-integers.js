const subject = new URLSearchParams("first=1&second=two&first=3");
const result = subject.delete("text", "text");
console.log(typeof result, result === undefined);

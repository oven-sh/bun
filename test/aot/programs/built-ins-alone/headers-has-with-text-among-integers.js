const subject = new Headers({ first: "1", second: "two" });
const result = subject.has("text");
console.log(typeof result, result);

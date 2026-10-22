const subject = new Headers({ first: "1", second: "two" });
const result = subject.get("text");
console.log(result === null);
